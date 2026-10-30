import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { databaseTracking, untilOnlyTheHeldWait } from '../views-testing/database-tracking.ts';
import { heldFolds, heldReads } from '../views-testing/pool-faults.ts';
import {
  overrunningFold,
  overrunningFolding,
  overrunsItsDeadline,
  overtimesOf,
  steppedClock,
  untilTried,
} from '../views-testing/stepped-sweeps.ts';
import * as documents from '../views-testing/view-documents.ts';
import { viewHarness, type ViewHarness } from '../views-testing/view-harness.ts';
import { playbookPass, type PassParts } from './playbook-pass.ts';
import { definitionsByType } from './projector-schedule.ts';

const { alpha, alphaKey, counting, detailsOf, foldedAll, foldingOf, isLive, liveWith, succeeded } = documents;

const playbooks = [alpha, { org: 'acme', playbook: 'beta' }, { org: 'acme', playbook: 'gamma' }];

async function viewsInEveryPlaybook(views: ViewHarness): Promise<void> {
  await Promise.all(
    playbooks.map(async (playbook) => {
      await views.saved('runs', counting, playbook);
      await views.ran('reasoning/runs', 1, { playbook });
    }),
  );
}

function partsOf(views: ViewHarness, database: PassParts['database'], pagesPerWake: number): PassParts {
  return {
    database,
    note: () => Effect.void,
    settings: views.settingsOf({ pagesPerWake, folding: { ...foldingOf(), pageBudgetMs: 60_000 } }),
    definitions: definitionsByType().of,
    resting: { isResting: () => false, rest: Function.constVoid },
    firstSeen: () => true,
    trouble: () => Effect.void,
  };
}

function runsOf(count: number): readonly number[] {
  return Array.from({ length: count }, (_, run) => run);
}

describe('the pages of a pass', () => {
  it('reads at most the pages a pass may for a live view, and asks for another pass', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    await Effect.runPromise(playbookPass(partsOf(views, views.store.database, 10), alphaKey));
    const caughtUp = await views.viewOf('runs');
    await views.ranInOneStream('reasoning/runs', runsOf(2500));
    const reads = heldReads(views.store.database);
    reads.open();

    const more = await Effect.runPromise(playbookPass(partsOf(views, reads.gated, 2), alphaKey));
    const kept = await views.viewOf('runs');

    expect([caughtUp?.phase, caughtUp?.folded]).toEqual(['live', 1]);
    expect([more, reads.total(), kept?.phase, kept?.folded]).toEqual([true, 2, 'live', 2001]);
  });

  it('reads at most the pages a pass may for a rebuilding view, and asks for another pass', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ranInOneStream('reasoning/runs', runsOf(2500));
    const reads = heldReads(views.store.database);
    reads.open();

    const more = await Effect.runPromise(playbookPass(partsOf(views, reads.gated, 2), alphaKey));
    const kept = await views.viewOf('runs');

    expect([more, reads.total(), kept?.folded]).toEqual([true, 2, 1999]);
  });
});

describe('the share of a projector', () => {
  it('passes at most as many playbooks at once as it may', async () => {
    const views = await viewHarness(await onSQLite());
    await viewsInEveryPlaybook(views);
    const tracking = databaseTracking();
    const reads = heldReads(tracking.over(views.store.database));
    views.start({ through: () => reads.gated, playbooksAtOnce: 2 });

    await untilOnlyTheHeldWait(reads.waiting, tracking, 2);
    const most = reads.most();
    reads.open();
    await Promise.all(playbooks.map((playbook) => views.until('runs', liveWith(1), playbook)));

    expect(most).toBe(2);
  });

  it('folds in at most half the workers of the pool at once', async () => {
    const views = await viewHarness(await onSQLite());
    await viewsInEveryPlaybook(views);
    const tracking = databaseTracking();
    const folds = heldFolds(views.pool);
    views.start({ pool: folds.gated, through: tracking.over });

    await untilOnlyTheHeldWait(folds.waiting, tracking, 2);
    const most = folds.most();
    folds.open();
    await Promise.all(playbooks.map((playbook) => views.until('runs', liveWith(1), playbook)));

    expect([views.pool.workers, most]).toEqual([4, 2]);
  });
});

describe('a fold that ran past its deadline', () => {
  it('is tried again at the next sweep, not the next page, while the other views of its playbook go on', async () => {
    const views = await viewHarness(await onSQLite());
    const clock = steppedClock(Date.parse('2026-10-06T09:00:00.000Z'));
    await views.saved('slow', detailsOf(overrunningFold, succeeded, { initial: 0 }));
    await views.saved('quick', counting);
    views.start({ folding: overrunningFolding(), clock, sweepEveryMs: 10_000 });
    await Promise.all([views.until('slow', isLive), views.until('quick', isLive)]);

    await views.ran('reasoning/runs', overrunsItsDeadline);
    await untilTried(views, 'slow', 1);
    await views.ran('reasoning/runs', 'quick');
    await views.until('quick', foldedAll(2));
    const beforeTheSweep = await overtimesOf(views, 'slow');
    clock.step(10_000);
    await untilTried(views, 'slow', 2);

    expect(beforeTheSweep).toBe(1);
  });
});
