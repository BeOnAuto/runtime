import { summaryRunIdOf, type GoalsPorts } from '@on.auto/goals';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { tellOwner } from '../../testing/goals/notice-facts.ts';
import { servingGoalNotices, type NoticeServer } from '../../testing/goals/notice-servers.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const goal = 'retired-orders';

const day = 86_400_000;

const hour = 3_600_000;

const midnightAfter = (instant: number) => Math.floor(instant / day) * day + day;

const goalsWith = (window: string | undefined) =>
  [
    `- id: ${goal}`,
    '  statement: Every day brings in an order from the shop.',
    ...(window === undefined ? [] : [`  window: ${window}`]),
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
  readonly clock: ReturnType<typeof movedClock>;
  readonly performs: () => number;
}

async function retiredPlaybook(goals = dailyAndHourly): Promise<Counted> {
  const clock = movedClock(Date.now());
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
  const created = await createdWithGoals(served.server, { goals });
  const saved = await served.server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner.replace('expires: PT4H', 'expires: P30D'), diagram: 'none' },
  });
  const retired = await served.server.call('POST', `${alpha}/retire`, { body: {} });
  expect([created.status, saved.status, retired.status]).toEqual([201, 201, 200]);
  return { served, clock, performs: () => counted.clock + served.performs() };
}

async function settledAt(counted: Counted, at: number): Promise<number> {
  const before = counted.performs();
  counted.clock.moveTo(at);
  await new Promise((resolve) => {
    setTimeout(resolve, 1500);
  });
  return until(
    async () => {
      const seen = counted.performs();
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      return seen === counted.performs() ? seen - before : -1;
    },
    (performs) => performs >= 0,
  );
}

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
  it('is performed on only once a day for a week by its clock, notices and summaries, and sends its summary after a restore', async () => {
    const counted = await retiredPlaybook();
    const nextHour = Math.ceil(Date.now() / hour) * hour;
    const firstMidnight = midnightAfter(nextHour);
    const atTheHour = await settledAt(counted, nextHour + 1000);
    const days = await daysFrom(counted, firstMidnight, 7);
    const postedWhileRetired = counted.served.chat.chat.posted().length;
    const restored = await counted.served.server.call('POST', `${alpha}/restore`, { body: {} });
    const resumedAt = firstMidnight + 7 * day;
    counted.clock.moveTo(resumedAt + 1000);
    const posted = await until(
      () => counted.served.chat.chat.posted(),
      (messages) => messages.length > 0,
    );

    expect(atTheHour).toBeGreaterThan(0);
    expect(days).toEqual(Array.from({ length: 7 }, () => [true, 0]));
    expect(postedWhileRetired).toBe(0);
    expect(restored.status).toBe(200);
    expect(posted).toHaveLength(1);
    expect(await counted.served.runs()).toContain(summaryRunIdOf(goal, resumedAt));
  }, 180_000);
});

describe('a retired playbook on a Node server whose goal has no daily boundary and an hourly summary', () => {
  it.each([
    ['a weekly', '{ calendar: week, grace: PT1H }'],
    ['a monthly', '{ calendar: month, grace: PT1H }'],
    ['no', undefined],
  ])(
    'with %s window is performed on only at each UTC midnight for a week, and sends its summary after a restore',
    async (_named, window) => {
      const counted = await retiredPlaybook(goalsWith(window));
      const nextHour = Math.ceil(Date.now() / hour) * hour;
      const firstMidnight = midnightAfter(nextHour);
      await settledAt(counted, nextHour + 1000);
      const days = await daysFrom(counted, firstMidnight, 7);
      const restored = await counted.served.server.call('POST', `${alpha}/restore`, { body: {} });
      const resumedAt = firstMidnight + 7 * day;
      counted.clock.moveTo(resumedAt + 1000);
      await until(
        () => counted.served.chat.chat.posted(),
        (messages) => messages.length > 0,
      );

      expect(days).toEqual(Array.from({ length: 7 }, () => [true, 0]));
      expect(restored.status).toBe(200);
      expect(await counted.served.runs()).toContain(summaryRunIdOf(goal, resumedAt));
    },
    180_000,
  );
});
