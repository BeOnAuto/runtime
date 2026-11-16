import { sha256Of } from '@on.auto/content';
import type { Ledger, ProjectedRowsQuery } from '@on.auto/operations';
import {
  heldNotes,
  noteHolders,
  runTallies,
  runTallyRows,
  topicFacts,
  topicRows,
  type HeldNote,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { aStreamLedger, historyOf, keptWith, readLogged } from '../stream-projections/stream-testing.ts';
import { aLedger, aLedgerHolding, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  alpha,
  archivedBySQL,
  archivedStreams,
  keptStreams,
  ofTheRuns,
  playbookKey,
  writtenTo,
  type WrittenStream,
} from './archived-streams.ts';

type AnyLedger = Ledger['Service'];

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const archivedNames = archivedStreams.map(({ stream }) => stream);

async function aDatabaseHolding(entry: LedgerEntry, written: readonly WrittenStream[]): Promise<string> {
  const database = await entry.aDatabase();
  const store = entry.storeOn(database);
  await store.migrate();
  await writtenTo(store, written);
  await store.close();
  return database;
}

async function twins(entry: LedgerEntry): Promise<{ readonly never: string; readonly archived: string }> {
  const never = await aDatabaseHolding(entry, keptStreams);
  const archived = await aDatabaseHolding(entry, [...keptStreams, ...archivedStreams]);
  await archivedBySQL(entry, archived, archivedNames);
  return { never, archived };
}

async function filledOn(entry: LedgerEntry, database: string) {
  const ledger = await aLedger(entry, database, runTallies, [runTallyRows, topicRows]);
  const [tallies, topics, outcomes] = await Effect.runPromise(
    Effect.all([
      ledger.readProjectedRows('run_tallies', alpha, everyRow),
      ledger.readProjectedRows('topics', alpha, everyRow),
      ledger.readRunOutcomes(alpha, { from: '2026-10-01', to: '2026-10-02' }, {}),
    ]),
  );
  return { tallies, topics, outcomes };
}

function scrubbed(ledger: AnyLedger) {
  return Effect.runPromise(
    ledger.scrubFact(`${playbookKey}notes/kept`, 3, {
      eventSchema: topicFacts.eventSchema,
      data: { topic: 'shared', note: 'scrubbed' },
      erasure: { type: 'topic_noted', data: { topic: 'erased', note: '' } },
      context: ofTheRuns,
    }),
  );
}

async function refoldedOn(entry: LedgerEntry, database: string) {
  const ledger = await aLedger(entry, database, undefined, [topicRows]);
  await scrubbed(ledger);
  return Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow));
}

function kept(content: string): HeldNote {
  return { type: 'note_kept', data: { sha256: sha256Of(content) } };
}

function noted(ledger: AnyLedger, stream: string, note: HeldNote): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, heldNotes, [note]));
}

function filledAtOpen(entry: LedgerEntry): void {
  it('fills a projection keyed by stream, a projection keyed by its mapping and the outcomes of runs, as the ledger opens, as over a database that never held the archived streams', async () => {
    const { never, archived } = await twins(entry);

    const fromNever = await filledOn(entry, never);

    expect(await filledOn(entry, archived)).toEqual(fromNever);
    expect([fromNever.tallies.map(({ key }) => key), fromNever.topics.map(({ key }) => key)]).toEqual([
      ['kept'],
      ['kept', 'shared'],
    ]);
  });
}

function refoldedOnAScrub(entry: LedgerEntry): void {
  it('folds again the row of a projection keyed by its mapping, when a fact of it is scrubbed, as over a database that never held the archived streams', async () => {
    const { never, archived } = await twins(entry);

    const fromNever = await refoldedOn(entry, never);

    expect(await refoldedOn(entry, archived)).toEqual(fromNever);
    expect(fromNever.map(({ key, row }) => [key, row['note']])).toEqual([
      ['kept', null],
      ['shared', 'scrubbed'],
    ]);
  });
}

function builtOnFirstRead(entry: LedgerEntry): void {
  it('builds a stream projection on its first read from the streams that are not archived', async () => {
    const database = await entry.aDatabase();
    await historyOf(await aStreamLedger(entry, database), 'alpha');
    await archivedBySQL(entry, database, ['playbook/acme/alpha/notes/n2']);

    const ledger = await aStreamLedger(entry, database, keptWith());

    expect((await readLogged(ledger)).rows).toEqual([
      ['n1/1', 1, 1],
      ['n1/3', 2, 3],
      ['n1', 'billing', 1, 3],
      ['n1', 'urgent', 2, 3],
    ]);
  });
}

function heldAtOpen(entry: LedgerEntry): void {
  it('fills the holds of content as the ledger opens from the facts that are not archived, so a content only an archived fact names is held by nothing', async () => {
    const database = await entry.aDatabase();
    const before = await aLedger(entry, database);
    await noted(before, `${playbookKey}notes/kept`, kept('kept'));
    await noted(before, `${playbookKey}notes/gone`, kept('gone'));
    await archivedBySQL(entry, database, [`${playbookKey}notes/gone`]);

    const after = await aLedgerHolding(entry, noteHolders, database);

    expect(
      await Effect.runPromise(
        Effect.all([after.removeUnheld(alpha, sha256Of('kept')), after.removeUnheld(alpha, sha256Of('gone'))]),
      ),
    ).toEqual(['held', 'removed']);
  });
}

export function archivedFillsBehaviour(entry: LedgerEntry): void {
  filledAtOpen(entry);
  refoldedOnAScrub(entry);
  builtOnFirstRead(entry);
  heldAtOpen(entry);
}
