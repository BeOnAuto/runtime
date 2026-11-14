import { summaryRunIdOf, windowOpeningAfter } from '@on.auto/goals';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { tellOwner } from '../../testing/goals/notice-facts.ts';
import { servingGoalNotices, type NoticeServer } from '../../testing/goals/notice-servers.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const goal = 'weekly-orders';

const summarisedGoals = [
  `- id: ${goal}`,
  '  statement: Keep the weekly orders coming in from the shop.',
  '  success:',
  '    label: Orders this week',
  '    settles: on_crossing',
  '    target: { at_least: 20 }',
  '    passed: Orders came in',
  '    failed: Orders fell short',
  '  notify:',
  '    passed: summary',
  '    failed: summary',
  '    through: tell-owner',
  "    summary: { cron: '0 9 * * 5' }",
  '',
].join('\n');

const headline = 'Keep the weekly orders coming in from the shop: 0 passed, 0 failed, 0 with no result';

const GapsSchema = Schema.Struct({
  goals: Schema.Array(Schema.Struct({ gaps: Schema.Array(Schema.Struct({ kind: Schema.String })) })),
});

function nextFridayAfter(at: number): number {
  return Result.getOrThrow(windowOpeningAfter({ kind: 'cron', expression: '0 9 * * 5' }, at)) ?? at;
}

async function summarisingPlaybook(served: NoticeServer): Promise<void> {
  const created = await createdWithGoals(served.server, { goals: summarisedGoals });
  const saved = await served.server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner.replace('expires: PT4H', 'expires: P10D'), diagram: 'none' },
  });
  expect([created.status, saved.status]).toEqual([201, 201]);
}

async function gapsOf(served: NoticeServer): Promise<readonly string[]> {
  const read = Schema.decodeUnknownSync(GapsSchema)((await served.server.call('GET', `${alpha}/goals`)).body);
  return read.goals.flatMap(({ gaps }) => gaps.map(({ kind }) => kind)).filter((kind) => kind.startsWith('notice_'));
}

describe('the summary of a goal on a Node server that keeps goals', () => {
  it('is sent at the time of its schedule as a heartbeat with no lines, once, and its start is recorded', async () => {
    const clock = movedClock(Date.now());
    const served = await servingGoalNotices({ clock });
    await summarisingPlaybook(served);
    const friday = nextFridayAfter(Date.now());
    clock.moveTo(friday + 1000);
    const posted = await until(
      () => served.chat.chat.posted(),
      (messages) => messages.length > 0,
    );
    const facts = await until(
      () => served.factsOf(`goal-summaries/${goal}`),
      (types) => types.includes('goal_summary_started'),
    );
    const settled = await served.server.settled(summaryRunIdOf(goal, friday));
    clock.moveTo(friday + 2 * 60_000);
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });

    expect(posted).toMatchObject([{ text: headline }]);
    expect(facts).toEqual(['goal_summary_started']);
    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(await served.runs()).toEqual([summaryRunIdOf(goal, friday)]);
    expect(served.chat.chat.posted()).toHaveLength(1);
    expect(served.performs()).toBe(1);
  });

  it('is refused through a paused function, sends nothing and shows as a gap', async () => {
    const clock = movedClock(Date.now());
    const served = await servingGoalNotices({ clock });
    await summarisingPlaybook(served);
    const paused = await served.server.call('POST', `${alpha}/definitions/interaction/tell-owner/pause`, { body: {} });
    clock.moveTo(nextFridayAfter(Date.now()) + 1000);

    const gaps = await until(
      () => gapsOf(served),
      (kinds) => kinds.length > 0,
    );

    expect(paused.status).toBe(200);
    expect(gaps).toEqual(['notice_not_started']);
    expect(await served.factsOf(`goal-summaries/${goal}`)).toEqual(['goal_notice_refused']);
    expect(await served.runs()).toEqual([]);
    expect(served.chat.chat.posted()).toEqual([]);
  });
});
