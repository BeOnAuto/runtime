import { topicFacts, topicRows, type TopicFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { carryingOnToTheLayoutKept, carryingTo } from '../layout/carrying-on-behaviour.ts';
import { layoutWritten } from '../layout/layout-kept.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { topicsOf } from '../projections/projections-behaviour.ts';
import { aLedger, anEmptyDatabaseOf, type LedgerEntry } from '../testing/ledger-entry.ts';
import { projectionCheckpointsLayout } from './checkpoints-step.ts';
import { aLedgerLogging } from './logged-opening.ts';

const everyCheckpoint =
  'SELECT projection, version, folded_through FROM projection_checkpoints ORDER BY projection, version';

const checkpointOfTheTopics =
  "SELECT projection, version, folded_through FROM projection_checkpoints WHERE projection = 'topics'";

const layoutOf = 'SELECT layout FROM ledger_layout';

function caughtUp(projection: string, version: number) {
  return { projection, version, folded_through: null };
}

const tablesOfTheNameForm = ['notes_3', 'run_tallies_12'];

const tablesOfOtherNames = ['notes', 'notes_v2', '_7', 'dmb_notes_1', 'emt_notes_2', 'tallies_99999999999'];

const tablesMade = [...tablesOfTheNameForm, ...tablesOfOtherNames];

const notesKept = `SELECT CAST(${tablesMade.map((table) => `(SELECT count(*) FROM ${table})`).join(' + ')} AS INTEGER) AS kept`;

const opened: TopicFact = { type: 'topic_opened', data: { topic: 'spring', at: 1000 } };

const carriedToTheStep = carryingTo(projectionCheckpointsLayout);

async function aDatabaseOfTheLayoutBefore(entry: LedgerEntry, tables: readonly string[]): Promise<string> {
  const database = await anEmptyDatabaseOf(entry);
  await entry.executedOn(database, (execute) => layoutWritten(execute, projectionCheckpointsLayout - 1));
  await inTurn(tables, async (table) => {
    await entry.queried(database, `CREATE TABLE ${table} (note TEXT)`);
    await entry.queried(database, `INSERT INTO ${table} (note) VALUES ('kept')`);
  });
  return database;
}

async function aStoreOfTheLayoutBeforeAdvancedByItsReader(entry: LedgerEntry): Promise<string> {
  const database = await anEmptyDatabaseOf(entry);
  const before = await aLedger(entry, database, undefined, [topicRows]);
  await Effect.runPromise(before.execute('playbook/acme/alpha/runs/r1', topicFacts, [opened]));
  await Effect.runPromise(
    before.advanceRow('topics', { org: 'acme', playbook: 'alpha' }, 'spring', { set: { open: false }, when: [] }),
  );
  await entry.queried(database, 'DROP TABLE projection_checkpoints');
  await entry.queried(database, `UPDATE ledger_layout SET layout = ${String(projectionCheckpointsLayout - 1)}`);
  return database;
}

function theStepOfAStore(entry: LedgerEntry): void {
  it('records each table whose name is a name and a version as caught up, under that name and version, and touches no table', async () => {
    const database = await aDatabaseOfTheLayoutBefore(entry, tablesMade);

    await entry.carriedOn(database, carriedToTheStep);

    expect(await entry.queried(database, everyCheckpoint)).toEqual([caughtUp('notes', 3), caughtUp('run_tallies', 12)]);
    expect(await entry.queried(database, notesKept)).toEqual([{ kept: tablesMade.length }]);
  });

  it('is taken once when two openings carry the database together', async () => {
    const database = await aDatabaseOfTheLayoutBefore(entry, ['notes_3']);

    await Promise.all([entry.carriedOn(database, carriedToTheStep), entry.carriedOn(database, carriedToTheStep)]);

    expect([await entry.queried(database, layoutOf), await entry.queried(database, everyCheckpoint)]).toEqual([
      [{ layout: projectionCheckpointsLayout }],
      [caughtUp('notes', 3)],
    ]);
  });
}

function aStoreOpenedAfterTheStep(entry: LedgerEntry): void {
  it('is not taken by a new database, which holds the table and, once it has first opened, a row for each projection its ledger keeps', async () => {
    const database = await anEmptyDatabaseOf(entry);

    await aLedger(entry, database, undefined, [topicRows]);

    expect(await entry.queried(database, everyCheckpoint)).toEqual([caughtUp('topics', topicRows.version)]);
  });

  it('carries a store of the layout before, whose projection is filled and advanced by its reader, so that it opens with no fold and nothing made again, the advanced value kept', async () => {
    const database = await aStoreOfTheLayoutBeforeAdvancedByItsReader(entry);

    await entry.carriedOn(database, carryingOnToTheLayoutKept);
    const { ledger, logged } = await aLedgerLogging(entry, database, [topicRows]);

    expect([(await topicsOf(ledger)).map(({ key, row }) => [key, row['open']]), logged]).toEqual([
      [['spring', false]],
      [],
    ]);
    expect(await entry.queried(database, checkpointOfTheTopics)).toEqual([caughtUp('topics', topicRows.version)]);
  });
}

export function checkpointsStepBehaviour(entry: LedgerEntry): void {
  describe("the ledger's own step that records the tables of projections as caught up", () => {
    theStepOfAStore(entry);
    aStoreOpenedAfterTheStep(entry);
  });
}
