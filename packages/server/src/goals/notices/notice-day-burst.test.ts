import { assessmentIdOf } from '@on.auto/goals';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { appendedIn } from '../../testing/goals/notice-facts.ts';
import { playbookToldBy, servingGoalNotices, type StartOver } from '../../testing/goals/notice-servers.ts';
import { leadGoalId } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const owed = 250;

const mostADay = 200;

const streams = Array.from(
  { length: owed },
  (_, index) => `assessments/${assessmentIdOf({ goal: leadGoalId, per: `experiment-${String(index)}` })}`,
);

function startsKeptIn(runs: Set<string>): StartOver {
  return () => (asked) =>
    Effect.sync(() => {
      runs.add(asked.runId);
    });
}

describe('one piece of work that owes hundreds of notices at once, on a Node server that keeps goals', () => {
  it('starts at most 200 in the day, counting each start as it is made, and refuses the rest', async () => {
    const runs = new Set<string>();
    const served = await servingGoalNotices({ startOver: startsKeptIn(runs) });
    await playbookToldBy(served);
    const { runtime } = await served.starting();
    const at = Date.now();
    await Effect.runPromise(
      Effect.forEach(
        streams,
        (stream, index) =>
          Effect.promise(async () => {
            const per = { id: `experiment-${String(index)}` };
            const opened = {
              goal: leadGoalId,
              goals_version: 1,
              per,
              rule: { settles: 'on_crossing', target: { at_least: 1 } },
              milestones: [],
            };
            await appendedIn(runtime, stream, { type: 'goal_assessment_opened', data: opened, at });
            const verdict = { verdict: 'passed', at: new Date(at).toISOString(), by: 'crossing', told: 'now' };
            await appendedIn(runtime, stream, { type: 'goal_assessed', data: verdict, at });
          }),
        { concurrency: 16 },
      ),
    );

    const refused = await until(
      async () =>
        (await Promise.all(streams.map((stream) => served.factsOf(stream)))).filter((facts) =>
          facts.includes('goal_notice_refused'),
        ).length,
      (count) => count >= owed - mostADay,
    );

    expect([runs.size, refused]).toEqual([mostADay, owed - mostADay]);
  }, 120_000);
});
