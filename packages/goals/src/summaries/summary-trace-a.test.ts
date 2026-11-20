import type { Goal } from '@on.auto/definitions/goals';
import { expect, it } from 'vitest';

import { goalIdentityOf } from '../assessor/assessor-ledger.ts';
import { traceBookOf } from '../golden-traces/trace-book.ts';
import type { Appended } from '../golden-traces/trace-ledger.ts';
import { performedAt } from '../notices/notice-samples.ts';
import { inputOf, summaryBookOf } from './summary-samples.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const iso = (at: number) => new Date(at).toISOString();

const controls: Goal = {
  id: 'controls-hold',
  statement: 'Keep every control passing, day after day.',
  window: { calendar: 'day', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'Controls held',
    failed: 'A control failed',
  },
  milestones: [],
  notify: {
    passed: 'quiet',
    failed: 'now',
    overdue: 'now',
    through: 'tell-owner',
    summary: { cron: '0 9 * * 5' },
  },
};

const controlsKey = `definition/acme/${goalIdentityOf(controls.id)}/`;

async function weekOfTraceA() {
  const summary = await summaryBookOf({ goals: [] });
  await summary.book.goalsSaved([controls], iso(day(-1, 12)));
  const book = traceBookOf(controls, day(-1, 12), goalIdentityOf(controls.id));
  const recorded = (at: number, appended: readonly Appended[]) =>
    appended.reduce<Promise<void>>(async (before, { assessment, fact }) => {
      await before;
      await summary.book.appendAt(`${controlsKey}assessments/${assessment}`, fact.type, fact.data, {
        at: iso(at),
        by: 'playbook:sales',
        definitionId: goalIdentityOf(controls.id),
      });
    }, Promise.resolve());
  const check = (at: number, failed: number, allReported: boolean) =>
    recorded(
      at,
      book.run({
        at,
        entry: { measures: '/failed', final: '/all_reported' },
        output: { failed, all_reported: allReported },
      }),
    );
  const ring = (at: number, reporting = true) => recorded(at, book.ring(at, { reporting }));

  await ring(day(0));
  await check(day(0, 9), 0, true);
  await ring(day(1));
  await ring(day(1, 1));
  await check(day(1, 9), 0, false);
  await ring(day(2));
  await ring(day(2, 1));
  await check(day(2, 9), 0, true);
  await check(day(2, 14), 1, false);
  await check(day(2, 16), 0, true);
  await ring(day(3));
  await ring(day(3, 1));
  await ring(day(4), false);
  await ring(day(4, 1), false);
  return summary;
}

it('sums up the week of trace A on Friday at 09:00, one line a day in its latest state', async () => {
  const summary = await weekOfTraceA();
  await performedAt(summary.work, day(4, 9));

  expect(summary.starts.map(({ runId, trigger }) => [runId, trigger.reference])).toEqual([
    [expect.any(String), `goals/${goalIdentityOf(controls.id)}/summaries/${iso(day(4, 9))}`],
  ]);
  expect(inputOf(summary.starts[0])).toEqual({
    change: 'summary',
    headline: 'Keep every control passing, day after day: 1 passed, 2 failed, 1 with no result',
    detail: [
      'Controls held: Monday, November 9 (Failing controls: 0)',
      'A control failed: Tuesday, November 10',
      'A control failed: Wednesday, November 11 (Failing controls: 1)',
      'No result yet: Thursday, November 12',
    ].join('\n'),
    window: { from: iso(day(-1, 12)), to: iso(day(4, 9)) },
    counts: { passed: 1, failed: 2, overdue: 1, no_result: 0 },
    lines: [
      { title: 'Monday, November 9', word: 'Controls held', value: 0, at: iso(day(1, 1)) },
      { title: 'Tuesday, November 10', word: 'A control failed', at: iso(day(2, 1)) },
      { title: 'Wednesday, November 11', word: 'A control failed', value: 1, at: iso(day(2, 14)) },
      { title: 'Thursday, November 12', word: 'No result yet', at: iso(day(4, 1)) },
    ],
    more: 0,
    link: 'https://studio.test/?playbook=sales&goal=controls-hold',
    owner: { id: 'person:ada', name: 'Ada' },
    goal: { id: 'controls-hold', statement: 'Keep every control passing, day after day.' },
  });
});
