import { summaryRunIdOf, type GoalsPorts } from '@on.auto/goals';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { tellOwner } from '../../testing/goals/notice-facts.ts';
import { servingGoalNotices, type NoticeServer } from '../../testing/goals/notice-servers.ts';
import { wokenClock, type WokenClock } from '../../testing/goals/woken-clock.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const goal = 'retired-orders';

const day = 86_400_000;

const hour = 3_600_000;

const midnightAfter = (instant: number) => Math.floor(instant / day) * day + day;

const goalsWith = (window: string) =>
  [
    `- id: ${goal}`,
    '  statement: Every day brings in an order from the shop.',
    `  window: ${window}`,
    '  success:',
    '    label: Orders today',
    '    settles: on_crossing',
    '    target: { at_least: 1 }',
    '    passed: An order came in',
    '    failed: No order came in',
    '  notify:',
    '    passed: now',
    '    failed: now',
    '    overdue: now',
    '    through: tell-owner',
    "    summary: { cron: '0 * * * *' }",
    '',
  ].join('\n');

const dailyAndHourly = goalsWith('{ calendar: day, grace: PT1H }');

interface Counted {
  readonly served: NoticeServer;
  readonly clock: WokenClock;
  readonly performs: () => number;
}

async function retiredPlaybook(): Promise<Counted> {
  const clock = wokenClock(Date.now());
  const counted = { clock: 0 };
  const served = await servingGoalNotices({
    clock,
    goalsPortsOver: (ports: GoalsPorts): GoalsPorts => ({
      ...ports,
      registry: {
        status: (address) =>
          Effect.andThen(
            Effect.sync(() => {
              counted.clock += 1;
            }),
            ports.registry.status(address),
          ),
      },
    }),
  });
  const created = await createdWithGoals(served.server, { goals: dailyAndHourly });
  const saved = await served.server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner.replace('expires: PT4H', 'expires: P30D'), diagram: 'none' },
  });
  const retired = await served.server.call('POST', `${alpha}/retire`, { body: {} });
  expect([created.status, saved.status, retired.status]).toEqual([201, 201, 200]);
  return { served, clock, performs: () => counted.clock + served.performs() };
}

const settledAt = (counted: Counted, at: number): Promise<number> => counted.clock.quietAt(at, counted.performs);

async function daysFrom(
  counted: Counted,
  midnight: number,
  left: number,
): Promise<readonly (readonly [boolean, number])[]> {
  if (left === 0) {
    return [];
  }
  const atMidnight = await settledAt(counted, midnight + 1000);
  const between = await settledAt(counted, midnight + day - 1000);
  return [[atMidnight > 0, between], ...(await daysFrom(counted, midnight + day, left - 1))];
}

describe('a retired playbook on a Node server whose goal has a daily window and an hourly summary', () => {
  it('is performed on only once a day by its clock, notices and summaries, and sends its summary after a restore', async () => {
    const counted = await retiredPlaybook();
    const nextHour = Math.ceil(Date.now() / hour) * hour;
    const firstMidnight = midnightAfter(nextHour);
    const atTheHour = await settledAt(counted, nextHour + 1000);
    const days = await daysFrom(counted, firstMidnight, 2);
    const postedWhileRetired = counted.served.chat.chat.posted().length;
    const restored = await counted.served.server.call('POST', `${alpha}/restore`, { body: {} });
    const resumedAt = firstMidnight + 2 * day;
    counted.clock.moveTo(resumedAt + 1000);
    const posted = await until(
      () => counted.served.chat.chat.posted(),
      (messages) => messages.length > 0,
    );

    expect(atTheHour).toBeGreaterThan(0);
    expect(days).toEqual([
      [true, 0],
      [true, 0],
    ]);
    expect(postedWhileRetired).toBe(0);
    expect(restored.status).toBe(200);
    expect(posted).toHaveLength(1);
    expect(await counted.served.runs()).toContain(summaryRunIdOf(goal, resumedAt));
  });
});
