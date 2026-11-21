import { Effect } from 'effect';
import { expect } from 'vitest';

import { until } from '../testing/until.ts';

export { steppedClock } from '../testing/stepped-clock.ts';
import { rowsOfPlaybook } from '../views/view-reconciling.ts';
import type { FoldingSettings } from '../views/views-folding.ts';
import { foldingWorker } from './test-fold-workers.ts';
import { alphaKey, foldOf, foldingOf } from './view-documents.ts';
import type { ViewHarness } from './view-harness.ts';

export const overrunsItsDeadline = 'overruns its deadline';

export const overrunningFold = foldOf(
  `if (event.data.output === "${overrunsItsDeadline}") for (;;) {}\n  return view + 1;`,
);

const overrunningFoldWorker = foldingWorker({
  prelude: ['const hourMs = 3600000;', 'const late = { on: false, reads: 0 };'],
  clock: {
    starting: 'const frozenAt = host.now(); late.on = false;',
    now: '() => frozenAt + (late.on ? (late.reads += 1) * hourMs : 0)',
  },
  whenFolding: `late.on = events[event]?.data?.output === '${overrunsItsDeadline}'; late.reads = 0;`,
  serving: 'serveJobs({ fold });',
});

export function overrunningFolding(): FoldingSettings {
  return { ...foldingOf(), budget: 1_000_000_000, worker: overrunningFoldWorker };
}

export const takesItsNeighboursTime = 'takes its neighbours time';

const neighbourFoldDeadlineMs = 1000;

const neighbourTimeMs = 1600;

const delayingFoldWorker = foldingWorker({
  prelude: ['const late = { byMs: 0 };'],
  clock: { starting: 'const frozenAt = host.now(); late.byMs = 0;', now: '() => frozenAt + late.byMs' },
  whenFolding: `if (events[event]?.data?.output === '${takesItsNeighboursTime}') late.byMs += ${neighbourTimeMs};`,
  serving: 'serveJobs({ fold });',
});

export function delayingFolding(): FoldingSettings {
  return { ...foldingOf(), foldDeadlineMs: neighbourFoldDeadlineMs, pageBudgetMs: 1, worker: delayingFoldWorker };
}

export async function overtimesOf(views: ViewHarness, name: string): Promise<number | undefined> {
  const rows = await Effect.runPromise(rowsOfPlaybook(views.store.database, alphaKey));
  return rows.find((row) => row.name === name)?.overtimes;
}

export function untilTried(views: ViewHarness, name: string, overtimes: number): Promise<void> {
  return until(async () => {
    expect(await overtimesOf(views, name)).toBe(overtimes);
  });
}
