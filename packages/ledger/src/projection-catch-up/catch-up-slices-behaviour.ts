import {
  ProjectionCatchingUp,
  type KeptProjection,
  type Ledger,
  type ProjectedRowsQuery,
  type RunOutcomeMapping,
} from '@on.auto/operations';
import {
  LabelFactSchema,
  labelFacts,
  labelRows,
  labelRowsByNote,
  runFacts,
  runTallies,
  runTallyRows,
  tallyRowsOf,
  topicFacts,
  topicRows,
  type LabelFact,
  type RunFact,
} from '@on.auto/operations/testing';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { CatchUpState } from '../event-store.ts';
import { loggingLayerOf } from '../projection-checkpoints/logged-opening.ts';
import { caughtUpAt, checkpointsOfTheTallies } from '../projection-checkpoints/projection-checkpoints-behaviour.ts';
import type { EntryKept, LedgerEntry } from '../testing/ledger-entry.ts';
import { openChoresWith, openLedgerWith } from '../testing/open-ledger.ts';

type AnyLedger = Ledger['Service'];

type Budget = EntryKept['catchUpBudget'];

interface Kept {
  readonly projections: readonly KeptProjection[];
  readonly runOutcomes?: RunOutcomeMapping;
}

interface Sliced {
  readonly ledger: AnyLedger;
  readonly slice: () => Promise<CatchUpState>;
  readonly state: () => Promise<CatchUpState>;
}

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const onePage: Budget = { pages: 1 };

const twoPages: Budget = { pages: 2 };

const morePagesThanItTakes: Budget = { pages: 100 };

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };

const noted: RunFact = { type: 'run_noted', data: {} };

const failed: RunFact = { type: 'run_ended', data: { status: 'failed', ms: 10, tokens: null } };

const tallies = 'SELECT row_key, facts FROM run_tallies_2 ORDER BY row_key';

const positionOfTheTallies = "SELECT folded_through FROM projection_checkpoints WHERE projection = 'run_tallies'";

const n1 = 'playbook/acme/alpha/notes/n1';

function inSlices(entry: LedgerEntry, database: string, { projections, runOutcomes }: Kept, catchUpBudget?: Budget) {
  return entry.ledgerOn(database, runOutcomes, projections, { mostBytesFilledAtOnce: 1, catchUpBudget });
}

async function openedInSlices(entry: LedgerEntry, database: string, kept: Kept, budget?: Budget): Promise<Sliced> {
  const { ledger, catchUpSlice, catchUpState, dispose } = await openChoresWith(inSlices(entry, database, kept, budget));
  onTestFinished(dispose);
  return { ledger, slice: catchUpSlice, state: catchUpState };
}

async function keptInline(entry: LedgerEntry, database: string, kept: Kept): Promise<AnyLedger> {
  return (await openedInSlices(entry, database, kept)).ledger;
}

const theTallies: Kept = { projections: [runTallyRows] };

function ran(ledger: AnyLedger, run: string, ...facts: readonly RunFact[]) {
  return Effect.runPromise(ledger.execute(`playbook/acme/alpha/runs/${run}`, runFacts, facts));
}

function labelled(ledger: AnyLedger, ...facts: readonly LabelFact[]) {
  return Effect.runPromise(ledger.execute(n1, labelFacts, facts));
}

async function talliedHistory(ledger: AnyLedger): Promise<void> {
  await ran(ledger, 'r1', began, noted, noted);
  await ran(ledger, 'r2', began, failed);
  await ran(ledger, 'r3', began);
}

async function slicedToTheEnd(
  slice: () => Promise<CatchUpState>,
  seen: () => Promise<unknown>,
): Promise<readonly (readonly unknown[])[]> {
  const state = await slice();
  const after = [state, await seen()];
  return state === 'caught_up' ? [after] : [after, ...(await slicedToTheEnd(slice, seen))];
}

async function isRefused(read: Effect.Effect<unknown>): Promise<boolean> {
  const exit = await Effect.runPromiseExit(read);
  return Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof ProjectionCatchingUp;
}

function furtherSlices(entry: LedgerEntry): void {
  it('go on as many pages a slice as the budget gives, answering catching up, as the state of the chore does after each, until the slice that finishes; an append between two slices is in the table once, and the append after the last is folded at once', async () => {
    const database = await entry.aDatabase();
    await talliedHistory(await keptInline(entry, database, theTallies));
    await entry.queried(database, 'DROP TABLE run_tallies_2');
    const { ledger, slice, state } = await openedInSlices(entry, database, theTallies, twoPages);
    await ran(ledger, 'r3', noted);
    const whileCatchingUp = await entry.queried(database, tallies);

    const slices = await slicedToTheEnd(slice, () =>
      Promise.all([state(), entry.queried(database, positionOfTheTallies)]),
    );
    const whole = await entry.queried(database, tallies);
    await ran(ledger, 'r3', noted);

    expect(whileCatchingUp).toEqual([{ row_key: 'r1', facts: 2 }]);
    expect(slices).toEqual([
      ...['4', '6'].map((position) => ['catching_up', ['catching_up', [{ folded_through: position }]]]),
      ['caught_up', ['caught_up', [{ folded_through: null }]]],
    ]);
    expect(whole).toEqual([
      { row_key: 'r1', facts: 3 },
      { row_key: 'r2', facts: 2 },
      { row_key: 'r3', facts: 2 },
    ]);
    expect(await entry.queried(database, tallies)).toEqual([
      { row_key: 'r1', facts: 3 },
      { row_key: 'r2', facts: 2 },
      { row_key: 'r3', facts: 3 },
    ]);
  });
}

function anEarlierVersion(entry: LedgerEntry): void {
  it('keeps the table of the earlier version through every slice that stops, and drops it with its row after the slice that finishes', async () => {
    const database = await entry.aDatabase();
    await talliedHistory(await keptInline(entry, database, theTallies));
    const { slice } = await openedInSlices(entry, database, { projections: [tallyRowsOf(3)] }, onePage);

    const slices = await slicedToTheEnd(slice, () => entry.queried(database, entry.projectionTables));

    expect(slices).toEqual([
      ...Array.from({ length: 5 }, () => ['catching_up', [{ name: 'run_tallies_2' }, { name: 'run_tallies_3' }]]),
      ['caught_up', [{ name: 'run_tallies_3' }]],
    ]);
    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([caughtUpAt(3)]);
  });
}

function aSetLeftBehind(entry: LedgerEntry): void {
  it('folds an append and serves a read of a table that another opening has caught up since the last slice, taking it out of the tables catching up', async () => {
    const database = await entry.aDatabase();
    await talliedHistory(await keptInline(entry, database, theTallies));
    await entry.queried(database, 'DROP TABLE run_tallies_2');
    const { ledger } = await openedInSlices(entry, database, theTallies, onePage);
    await keptInline(entry, database, theTallies);

    await ran(ledger, 'r3', noted);
    const refused = await isRefused(ledger.readProjectedRows('run_tallies', alpha, everyRow));

    expect([refused, await entry.queried(database, tallies)]).toEqual([
      false,
      [
        { row_key: 'r1', facts: 3 },
        { row_key: 'r2', facts: 2 },
        { row_key: 'r3', facts: 2 },
      ],
    ]);
  });
}

function readsOfTheTopicsAndOutcomes(ledger: AnyLedger): readonly Effect.Effect<unknown>[] {
  return [
    ledger.readProjectedRows('topics', alpha, everyRow),
    ledger.countProjectedRows('topics', alpha, []),
    ledger.readDueRows('topics', { column: 'due_at', through: 10_000, limit: 10 }),
    ledger.nextDueOf('topics', 'due_at', 0),
    ledger.advanceRow('topics', alpha, 'spring', { set: { open: false }, when: [] }),
    ledger.readRunOutcomes(alpha, { from: '2026-10-01', to: '2026-10-31' }, {}),
  ];
}

function readsRefused(entry: LedgerEntry): void {
  it('refuse a table catching up, through each of the five ports and the read of the outcomes of runs, serve a caught-up table beside it meanwhile, and serve it once it is caught up', async () => {
    const database = await entry.aDatabase();
    const kept: Kept = { projections: [runTallyRows, topicRows], runOutcomes: runTallies };
    const inline = await keptInline(entry, database, kept);
    await ran(inline, 'r1', began);
    await Effect.runPromise(
      inline.execute(n1, topicFacts, [{ type: 'topic_opened', data: { topic: 'spring', at: 1000 } }]),
    );
    await entry.queried(database, 'DROP TABLE topics_2');
    await entry.queried(database, 'DROP TABLE run_outcomes_5');
    const { ledger, slice } = await openedInSlices(entry, database, kept, onePage);

    const whileCatchingUp = await Promise.all(readsOfTheTopicsAndOutcomes(ledger).map((read) => isRefused(read)));
    const beside = await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, everyRow));
    await slicedToTheEnd(slice, () => Promise.resolve());
    const caughtUp = await Promise.all(readsOfTheTopicsAndOutcomes(ledger).map((read) => isRefused(read)));

    expect(whileCatchingUp).toEqual([true, true, true, true, true, true]);
    expect(beside.map(({ key }) => key)).toEqual(['r1']);
    expect(caughtUp).toEqual([false, false, false, false, false, false]);
    expect(await Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow))).toMatchObject([
      { key: 'spring', row: { open: false } },
    ]);
  });
}

function labelsOf(ledger: AnyLedger, projection: string) {
  return Effect.runPromise(ledger.readProjectedRows(projection, alpha, everyRow));
}

function aScrubWhileCatchingUp(entry: LedgerEntry): void {
  it('starts a table catching up again where a scrub changes a fact it folds, empty and at the start, refolds a caught-up table beside it, and catches the first up to the rows the second keeps inline', async () => {
    const database = await entry.aDatabase();
    const kept: Kept = { projections: [labelRows, labelRowsByNote, runTallyRows] };
    const inline = await keptInline(entry, database, kept);
    await labelled(inline, { type: 'labels_set', data: { note: 'n1', labels: ['urgent', 'billing'] } });
    await labelled(inline, { type: 'label_added', data: { note: 'n1', label: 'late' } });
    await entry.queried(database, 'DROP TABLE labels_1');
    const { ledger, slice } = await openedInSlices(entry, database, kept, onePage);
    const beforeTheScrub = await entry.queried(database, 'SELECT child_key FROM labels_1 ORDER BY child_key');

    await Effect.runPromise(
      ledger.scrubFact(n1, 1, {
        eventSchema: LabelFactSchema,
        data: { note: 'n1', labels: ['urgent'] },
        erasure: { type: 'label_added', data: { note: 'n1', label: 'erased' } },
        context: { at: '2026-11-12T09:00:00.000Z', by: 'eraser' },
      }),
    );
    const startedAgain = await Promise.all([
      entry.queried(database, 'SELECT child_key FROM labels_1'),
      entry.queried(database, "SELECT folded_through FROM projection_checkpoints WHERE projection = 'labels'"),
    ]);
    const refolded = await labelsOf(ledger, 'note_labels');
    await slicedToTheEnd(slice, () => Promise.resolve());

    expect(beforeTheScrub).toEqual([{ child_key: 'billing' }, { child_key: 'urgent' }]);
    expect(startedAgain).toEqual([[], [{ folded_through: '0' }]]);
    expect(refolded.map(({ child }) => child)).toEqual(['erased', 'late', 'urgent']);
    expect(await labelsOf(ledger, 'labels')).toEqual(refolded);
  });
}

function aPageThatThrows(entry: LedgerEntry): void {
  it('logs an error where a page throws under a budget, ends the slice there, keeps the pages before it, and returns from the opening, its table refused', async () => {
    const database = await entry.aDatabase();
    await talliedHistory(await keptInline(entry, database, theTallies));
    await entry.queried(database, 'DROP TABLE run_tallies_2');
    const failingOnAFailure = tallyRowsOf(2, (row) => row['status'] === 'failed');
    const failing = loggingLayerOf(
      inSlices(entry, database, { projections: [failingOnAFailure] }, morePagesThanItTakes),
    );

    const { ledger, dispose } = await openLedgerWith(failing.layer);
    onTestFinished(dispose);

    expect(failing.logged).toEqual([{ level: 'ERROR', annotations: { position: '4' } }]);
    expect([await entry.queried(database, positionOfTheTallies), await entry.queried(database, tallies)]).toEqual([
      [{ folded_through: '4' }],
      [
        { row_key: 'r1', facts: 3 },
        { row_key: 'r2', facts: 1 },
      ],
    ]);
    expect(await isRefused(ledger.readProjectedRows('run_tallies', alpha, everyRow))).toBe(true);
  });
}

export function catchUpSlicesBehaviour(entry: LedgerEntry): void {
  describe('a catch-up given a budget, a slice at a time', () => {
    furtherSlices(entry);
    anEarlierVersion(entry);
    aSetLeftBehind(entry);
    readsRefused(entry);
    aScrubWhileCatchingUp(entry);
    aPageThatThrows(entry);
  });
}
