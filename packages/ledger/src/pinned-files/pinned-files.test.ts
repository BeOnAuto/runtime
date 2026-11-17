import { describe, expect, it } from 'vitest';

import { recordingAsked, recordingVariable } from '../recorded-facts/recorded-facts-behaviour.ts';
import { queried } from '../recorded/sqlite-checks.ts';
import { appendedAndReadBack, failedRun } from './append-read-back.ts';
import { fileReadOf, rowCountsOf } from './file-read.ts';
import { readAsALedger } from './ledger-reads.ts';
import { aCopyOf, aCopyOfTheDatabaseFileAlone } from './pinned-copies.ts';
import { databaseFileOf, filesKeptOf, pinnedEndings, recordOf, type PinnedEnding } from './pinned-record.ts';
import { recordedWhereMissing } from './pinned-recording.ts';
import { pinnedStreams } from './pinned-scenario.ts';

const writtenAtLayout25 = new URL('layout-25/', import.meta.url);

await recordedWhereMissing(writtenAtLayout25, 25, recordingAsked());

const endings: Readonly<Record<PinnedEnding, string>> = {
  closed: 'the file of a ledger that closed',
  'ended-without-closing': 'the file of a ledger whose process ended without closing it',
};

function readByTheDriverAlone(ending: PinnedEnding): void {
  it(`is ${endings[ending]}, at layout 25, file for file the bytes recorded`, () => {
    const record = recordOf(writtenAtLayout25, ending);

    expect({ layout: record.layout, files: filesKeptOf(writtenAtLayout25, ending) }).toEqual({
      layout: 25,
      files: record.files,
    });
  });

  it('reads through the driver of the ledger alone, with no layout check, as the add-on read it: its integrity, its header and every row of every table', async () => {
    const record = recordOf(writtenAtLayout25, ending);

    const read = await fileReadOf(aCopyOf(writtenAtLayout25, ending));

    expect(read).toEqual(record.file);
    expect(read.integrity).toEqual(['ok']);
  });
}

type TablesRead = Awaited<ReturnType<typeof fileReadOf>>['tables'];

const changedByTheSteps: ReadonlySet<string> = new Set(['ledger_layout', 'sqlite_schema']);

function tablesKeptOf(recorded: TablesRead): readonly string[] {
  return Object.keys(recorded).filter((table) => !changedByTheSteps.has(table));
}

function theTablesOf(tables: TablesRead, named: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(named.map((table) => [table, tables[table]]));
}

const ofANameAndAVersion = /^(?!sqlite_|emt_|dmb_).+_\d+$/u;

const tablesOfProjections: readonly (readonly [string, number])[] = [
  ['content_references', 2],
  ['definition_names', 1],
  ['label_notes', 1],
  ['label_sets', 1],
  ['labelled_checkpoints', 1],
  ['labelled_rows', 1],
  ['run_outcomes', 5],
  ['run_tallies', 2],
  ['topics', 2],
];

const checkpointsOfTheFile =
  'SELECT projection, version, folded_through FROM projection_checkpoints ORDER BY projection, version';

function openedAsALedgerCarriedFromLayout25(ending: PinnedEnding): void {
  it("opens through the ledger's entry, carried from layout 25 by the ledger's own steps as every store of layout 25 is, answers the ledger's reads as they were answered through the add-on, leaves every row of every table it held as it was but the layout's, and records the table of each projection as caught up", async () => {
    const record = recordOf(writtenAtLayout25, ending);
    const fileName = aCopyOf(writtenAtLayout25, ending);

    const reads = await readAsALedger(fileName);
    const read = await fileReadOf(fileName);

    expect(reads).toEqual(record.ledger);
    const kept = tablesKeptOf(record.file.tables);
    expect(theTablesOf(read.tables, kept)).toEqual(theTablesOf(record.file.tables, kept));
    expect(read.integrity).toEqual(['ok']);
    expect(Object.keys(record.file.tables).filter((table) => ofANameAndAVersion.test(table))).toEqual(
      tablesOfProjections.map(([projection, version]) => `${projection}_${String(version)}`),
    );
    expect(await queried(fileName, checkpointsOfTheFile)).toEqual(
      tablesOfProjections.map(([projection, version]) => ({ projection, version, folded_through: null })),
    );
  });

  it('carried from layout 25, takes an append after the facts it holds and reads it back from where the file ended', async () => {
    const readBack = await appendedAndReadBack(aCopyOf(writtenAtLayout25, ending));

    expect(readBack).toEqual({
      appended: [{ stream: pinnedStreams.openRun, ...failedRun }],
      version: 2,
      openRuns: 0,
    });
  });
}

describe(`the ledger files the sqlite3 add-on wrote at layout 25, which the tests record with ${recordingVariable}=1 where they are missing and never again`, () => {
  describe.each(pinnedEndings)('%s', (ending) => {
    readByTheDriverAlone(ending);
    openedAsALedgerCarriedFromLayout25(ending);
  });

  it('keeps, in the database file of the file whose ledger closed, the 15 facts appended before its checkpoint, and the 16th in its write-ahead log', async () => {
    const ending = 'closed';

    const alone = await fileReadOf(aCopyOfTheDatabaseFileAlone(writtenAtLayout25, ending));

    expect([rowCountsOf(alone), rowCountsOf(recordOf(writtenAtLayout25, ending).file)]).toMatchObject([
      { emt_messages: 15 },
      { emt_messages: 16 },
    ]);
  });

  it('keeps all 16 facts of the file whose process ended without closing its ledger in its write-ahead log, none in its database file', async () => {
    const ending = 'ended-without-closing';
    const record = recordOf(writtenAtLayout25, ending);

    const alone = await fileReadOf(aCopyOfTheDatabaseFileAlone(writtenAtLayout25, ending));

    expect(Object.keys(record.files)).toEqual([databaseFileOf(ending), `${databaseFileOf(ending)}-wal`]);
    expect([rowCountsOf(alone), rowCountsOf(record.file)]).toMatchObject([{ emt_messages: 0 }, { emt_messages: 16 }]);
  });
});
