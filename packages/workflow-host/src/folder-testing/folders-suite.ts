import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Writing } from '../projector/folder.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { reconciledRows, type DefinitionsKept } from '../projector/reconciled-rows.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { readsWhile, untilAWholeWakeHasPassed, watchedSystemClock } from '../testing/watched-clock.ts';
import { alphaKey, counting, foldedAll, liveWith } from '../views-testing/view-documents.ts';
import {
  talliesOf,
  tallyFolderOf,
  tallyOf,
  type TallyChange,
  type TallyDetails,
  type TallyRow,
} from './tally-folder.ts';
import { tallyHarness, type TallyHarness } from './tally-harness.ts';

const succeeded: TallyDetails = { counts: 'run_succeeded' };

const started: TallyDetails = { counts: 'run_started' };

const poisoned: TallyDetails = { counts: 'run_succeeded', stallsOn: 'poison' };

function liveCounting(counted: number): (row: TallyRow) => boolean {
  return (row) => row.phase === 'live' && row.counted === counted;
}

function phasesOf(rows: readonly TallyRow[]): Readonly<Record<string, string>> {
  return Object.fromEntries(rows.map(({ counts, phase }) => [counts, phase]));
}

function keptBy(tallies: TallyHarness): DefinitionsKept {
  return { database: tallies.store.database, definitions: definitionsByType().of };
}

function namedBy(rows: readonly TallyRow[], { counts }: TallyDetails): TallyRow | undefined {
  return rows.find((row) => row.counts === counts && row.stallsOn === null);
}

function outputsCounted(details: TallyDetails, outputs: readonly string[]) {
  return outputs.map((output) => ({ tally: tallyOf(details), output, counted: 1 }));
}

function writingBy(tallies: TallyHarness): Writing {
  return { database: tallies.store.database, playbook: alphaKey, note: tallies.reports.reports.note };
}

function withOutputs(change: TallyChange, next: Partial<TallyChange['next']> = {}): TallyChange {
  return { ...change, next: { ...change.next, ...next }, outputs: [['"elsewhere"', 1]] };
}

function sharingTests(settingsOf: SettingsOf): void {
  it('folds in the host’s own process into a table of its own, beside the views of recall functions, and shares their one read a wake once both are caught up', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.saved('runs', counting);
    await tallies.savedTally('succeeded', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    const clock = watchedSystemClock();
    tallies.startWithTallies({ sweepEveryMs: 60_000, clock });
    await tallies.until('runs', liveWith(2));
    await tallies.untilTally(succeeded, liveCounting(2));

    const shared = await readsWhile(tallies, clock, async () => {
      await tallies.ran('reasoning/runs', 3);
      await tallies.until('runs', foldedAll(3));
      await tallies.untilTally(succeeded, liveCounting(3));
    });

    expect(shared).toBe(1);
    expect(await tallies.outputs()).toEqual(outputsCounted(succeeded, ['1', '2', '3']));
  });
}

function phaseTests(settingsOf: SettingsOf): void {
  it('waits for a slot, rebuilds in it, goes live, and stalls at the event it cannot fold, folding nothing after it', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    await tallies.savedTally('started', started);
    await tallies.savedTally('unreadable', { nothing: 'to count' });
    const slotted = await Effect.runPromise(reconciledRows(tallyFolderOf(1), keptBy(tallies), alphaKey));
    await tallies.ran('reasoning/runs', 'fine');
    tallies.startWithTallies({}, 1);
    await tallies.untilTally(succeeded, liveCounting(1));
    await tallies.untilTally(started, liveCounting(1));

    await tallies.savedTally('poisoned', poisoned);
    await tallies.untilTally(poisoned, liveCounting(1));
    await tallies.ranEach('reasoning/runs', ['poison', 'after']);
    const stalled = await tallies.untilTally(poisoned, ({ phase }) => phase === 'stalled');
    await tallies.untilTally(succeeded, liveCounting(3));

    expect(phasesOf(slotted)).toEqual({ run_succeeded: 'rebuilding', run_started: 'waiting' });
    expect(stalled.counted).toBe(1);
    expect((await tallies.outputs()).filter(({ tally }) => tally === tallyOf(poisoned))).toEqual(
      outputsCounted(poisoned, ['"fine"']),
    );
  });
}

function restartTests(settingsOf: SettingsOf): void {
  it('keeps its checkpoint over a restart, so its row never leaves live and a new projector folds only what came after it, each event once', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    const first = tallies.startWithTallies();
    const before = await tallies.untilTally(succeeded, liveCounting(2));
    await first.stop();
    const watch = tallies.watchingTallies();

    await tallies.ranEach('reasoning/runs', [3, 4, 5]);
    const clock = watchedSystemClock();
    tallies.startWithTallies({ through: watch.through, clock });
    await tallies.untilTally(succeeded, liveCounting(5));
    await untilAWholeWakeHasPassed(clock);
    const [after] = await tallies.tallies();

    expect(before.checkpoint).toBeDefined();
    expect([...new Set(watch.phasesOf(succeeded))]).toEqual(['live']);
    expect([after?.phase, after?.counted]).toEqual(['live', 5]);
  });
}

function definitionTests(settingsOf: SettingsOf): void {
  it('rebuilds from the start when the part of its definition it is keyed by changes, rebuilds no row an edit leaves that part of or another definition still names, and drops a row once none names it', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('one', succeeded);
    await tallies.savedTally('another', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    const watch = tallies.watchingTallies();
    tallies.startWithTallies({ through: watch.through });
    await tallies.untilTally(succeeded, liveCounting(2));
    const shared = await tallies.tallies();
    const builtUntil = watch.phasesOf(succeeded).length;

    await tallies.savedTally('one', poisoned);
    const rebuilt = await tallies.untilTally(poisoned, liveCounting(2));
    await tallies.savedTally('another', succeeded);
    await tallies.ran('reasoning/runs', 3);
    await tallies.untilTally(succeeded, liveCounting(3));
    await tallies.untilTally(poisoned, liveCounting(3));
    const both = await tallies.tallies();
    const sinceBuilt = watch.phasesOf(succeeded).slice(builtUntil);
    await tallies.retiredTally('another');
    await tallies.goneTally(succeeded);
    const left = await tallies.outputs();

    expect([shared.length, both.length, rebuilt.counted]).toEqual([1, 2, 2]);
    expect([...new Set(left.map(({ tally }) => tally))]).toEqual([tallyOf(poisoned)]);
    expect([...new Set(sinceBuilt)]).toEqual(['live']);
    expect(namedBy(both, succeeded)?.saved).toBe(namedBy(shared, succeeded)?.saved);
  });
}

function rowTests(settingsOf: SettingsOf): void {
  it('takes no write, neither its outputs nor its row, from a pass that read its row before another wrote it', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    const folder = tallyFolderOf(1);
    const rows = await Effect.runPromise(reconciledRows(folder, keptBy(tallies), alphaKey));

    const stale = rows.map((row) => withOutputs(folder.unchanged({ ...row, checkpointText: 'not its checkpoint' })));
    const written = await Promise.all(
      stale.map((change) => Effect.runPromise(folder.write(writingBy(tallies), change))),
    );

    expect([written, stale.map((change) => folder.hasChanged(change))]).toEqual([[undefined], [false]]);
    expect([await tallies.tallies(), await tallies.outputs()]).toEqual([rows, []]);
  });

  it('keeps nothing of a write that fails midway, neither the outputs written before the failure nor its row', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    const folder = tallyFolderOf(1);
    const rows = await Effect.runPromise(reconciledRows(folder, keptBy(tallies), alphaKey));

    const failing = rows.map((row) => withOutputs(folder.unchanged(row), { counted: -1 }));
    const failures = await Promise.all(
      failing.map((change) => Effect.runPromise(Effect.flip(folder.write(writingBy(tallies), change)))),
    );

    expect(failures.map(({ detail }: { readonly detail: string }) => /check/iu.test(detail))).toEqual([true]);
    expect([await tallies.tallies(), await tallies.outputs()]).toEqual([rows, []]);
  });
}

function tableTests(settingsOf: SettingsOf): void {
  it('has its tables made on every open of the store, so they are made where missing and keep their rows where not', async () => {
    const settings = await settingsOf();
    const tallies = await tallyHarness(settings);
    await tallies.savedTally('succeeded', succeeded);
    await tallies.ran('reasoning/runs', 1);
    const projector = tallies.startWithTallies();
    const before = await tallies.untilTally(succeeded, liveCounting(1));
    await projector.stop();

    const reopened = await openedOn(settings, tallyFolderOf(1).tables);

    expect([await Effect.runPromise(talliesOf(reopened, alphaKey)), await tallies.outputs()]).toEqual([
      [before],
      outputsCounted(succeeded, ['1']),
    ]);
  });
}

export function foldersSuite(settingsOf: SettingsOf): void {
  describe('a second folder beside the views of recall functions', () => {
    sharingTests(settingsOf);
    phaseTests(settingsOf);
    restartTests(settingsOf);
    definitionTests(settingsOf);
    rowTests(settingsOf);
    tableTests(settingsOf);
  });
}
