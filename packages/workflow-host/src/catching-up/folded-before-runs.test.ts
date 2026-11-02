import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf, type TallyDetails } from '../folder-testing/tally-folder.ts';
import { tallyHarness, type TallyHarness } from '../folder-testing/tally-harness.ts';
import { someFolder } from '../projector/folder.ts';
import { onSQLite } from '../testing/host-files.ts';
import { answeredOnceFolded, answeringCapability } from './answered-runs.ts';
import { foldedBeforeItRuns, type FoldWaitBounds } from './folded-before-runs.ts';

const succeeded: TallyDetails = { counts: 'run_succeeded' };

function countedWhenAsked(tallies: TallyHarness, bounds?: FoldWaitBounds): Promise<unknown> {
  return answeredOnceFolded({
    answer: async () => (await tallies.tallies()).map(({ counted }) => counted),
    folders: [someFolder(tallyFolderOf(4))],
    database: tallies.store.database,
    ...(bounds === undefined ? {} : { bounds }),
  });
}

async function caughtUpOnce(tallies: TallyHarness): Promise<() => Promise<void>> {
  await tallies.savedTally('succeeded', succeeded);
  await tallies.ran('reasoning/runs', 1);
  const projector = tallies.startWithTallies();
  await tallies.untilTally(succeeded, (row) => row.phase === 'live' && row.counted === 1);
  return projector.stop;
}

describe('a run of a capability whose rows the projector folds', () => {
  it('waits until its rows have folded every run that ended before it started', async () => {
    const tallies = await tallyHarness(await onSQLite());
    const stopped = await caughtUpOnce(tallies);
    await stopped();
    await tallies.ran('reasoning/runs', 2);

    const counted = countedWhenAsked(tallies);
    await Effect.runPromise(Effect.sleep(100));
    tallies.startWithTallies();

    expect(await counted).toEqual([2]);
  });

  it('reads its rows as they are once its bound has passed, when the projector has not caught up by then', async () => {
    const tallies = await tallyHarness(await onSQLite());
    const stopped = await caughtUpOnce(tallies);
    await stopped();
    await tallies.ran('reasoning/runs', 2);
    const startedAt = performance.now();

    const counted = await countedWhenAsked(tallies, { mostMs: 200, everyMs: 20 });

    expect([counted, performance.now() - startedAt >= 200]).toEqual([[1], true]);
  });

  it('runs at once when its rows have folded the whole history, or the playbook has recorded nothing', async () => {
    const tallies = await tallyHarness(await onSQLite());
    const stopped = await caughtUpOnce(tallies);
    await stopped();
    const empty = await tallyHarness(await onSQLite());

    expect([await countedWhenAsked(tallies), await countedWhenAsked(empty)]).toEqual([[1], []]);
  });
});

describe('a capability that keeps no rows the projector folds', () => {
  it('runs as it is', async () => {
    const tallies = await tallyHarness(await onSQLite());
    const capability = answeringCapability(async () => (await tallies.tallies()).length);

    expect(foldedBeforeItRuns({ capability, folders: [], database: tallies.store.database })).toBe(capability);
  });
});
