import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { performedAt, sales } from '../notices/notice-samples.ts';
import { noticesSeenOf } from '../notices/notices-seen.ts';
import {
  friday,
  fridayRun,
  hour,
  inputOf,
  iso,
  linesOf,
  savedAt,
  summaryBookOf,
  summaryReference,
  thingsJudged,
  week,
  weekly,
  windowsEnded,
  type SummaryBook,
} from './summary-samples.ts';

async function summarisedThings() {
  const summary = await summaryBookOf();
  await thingsJudged(summary, 22);
  await performedAt(summary.work, friday);
  return summary.starts[0];
}

describe('a summary of more things than it has lines for', () => {
  it('counts every thing by its latest state and shows at most 20 lines with the count of the rest', async () => {
    const input = inputOf(await summarisedThings());

    expect(input['counts']).toEqual({ passed: 10, failed: 11, overdue: 1, no_result: 0 });
    expect(input['more']).toBe(2);
    expect(input['headline']).toBe(
      'Bring in paying customers through my experiments: 10 passed, 11 failed, 1 with no result',
    );
    expect(String(input['detail']).split('\n').at(-1)).toBe('and 2 more');
  });
});

describe('the lines of a summary', () => {
  it('names each thing by its own title or id, with its value, and links it to its place in Studio', async () => {
    const lines = linesOf(await summarisedThings());

    expect(lines).toHaveLength(20);
    expect(lines.slice(0, 2)).toEqual([
      {
        title: 'The spring trial',
        word: 'Brought no customer',
        value: 0,
        at: iso(savedAt + hour),
        link: 'https://studio.test/?playbook=sales&goal=paying-customers&per=experiment-10',
      },
      {
        title: 'experiment-11',
        word: 'Brought a customer',
        value: 1,
        at: iso(savedAt + hour + 60_000),
        link: 'https://studio.test/?playbook=sales&goal=paying-customers&per=experiment-11',
      },
    ]);
  });

  it('names a calendar week and month by their start, and a goal judged as a whole by its statement', async () => {
    const summary = await summaryBookOf();
    await windowsEnded(summary);
    await performedAt(summary.work, friday);
    const input = inputOf(summary.starts[0]);

    expect(input['detail']).toBe(
      [
        'No result: November 2026',
        'No result: Bring in paying customers through my experiments.',
        'No result: Week of November 9',
      ].join('\n'),
    );
    expect(input['counts']).toEqual({ passed: 0, failed: 0, overdue: 0, no_result: 3 });
  });
});

const lateThing = `assessments/${assessmentIdOf({ goal: weekly.id, per: 'experiment-late' })}`;

async function fridaySeen(summary: SummaryBook): Promise<void> {
  await performedAt(summary.work, friday);
  const started = await summary.book.runStarted(fridayRun(), summaryReference());
  const seen = noticesSeenOf(summary.book.ledger, () => friday);
  const batch = await Effect.runPromise(seen.batchOf({ playbook: sales, record: started }));
  await Effect.runPromise(Effect.forEach(batch.deliveries, ({ deliver }) => deliver));
}

async function linesAcrossTwoFridays(type: string, data: Schema.Json, recordedAt: number) {
  const summary = await summaryBookOf();
  await summary.book.append(
    lateThing,
    'goal_assessment_opened',
    {
      goal: weekly.id,
      goals_version: 1,
      per: { id: 'experiment-late' },
      rule: { settles: 'on_crossing', target: { at_least: 1 } },
      milestones: [],
    },
    { at: iso(savedAt), by: 'playbook:sales' },
  );
  await fridaySeen(summary);
  await summary.book.append(lateThing, type, data, { at: iso(recordedAt), by: 'playbook:sales' });
  await performedAt(summary.work, friday + week);
  return summary.starts.map((start) => linesOf(start).length);
}

describe('a change recorded after the summary that its named time falls before', () => {
  it('is in the next summary, as a crossing from a run that ended just before the summary', async () => {
    const verdict = { verdict: 'passed', at: iso(friday - 2_000), by: 'crossing', told: 'summary' };

    expect(await linesAcrossTwoFridays('goal_assessed', verdict, friday + 2_000)).toEqual([0, 1]);
  });

  it('is in the next summary, as an overdue the clock judged late after downtime', async () => {
    const overdue = { since: iso(friday - 8 * hour), told: 'summary' };

    expect(await linesAcrossTwoFridays('goal_overdue', overdue, friday + hour)).toEqual([0, 1]);
  });
});
