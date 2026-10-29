import { dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { sqliteLayout, sqliteLedgerOpened } from './index.ts';
import { sqliteLayoutCarried } from './layout/sqlite-schema.ts';
import { definitionStreamsIndexed, executedOn, planOf, queried } from './recorded/sqlite-checks.ts';
import { ledgerLayer, sqliteSecretRows } from './sqlite3.ts';
import { databaseStructureBehaviour } from './structure/database-structure-behaviour.ts';
import {
  appendedFactsOnStoresBehaviour,
  earlierShapesBehaviour,
  keptSecretsBehaviour,
  knownFactsBehaviour,
  ledgerBehaviour,
  logBehaviour,
  type LedgerEntry,
} from './testing/index.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

const openedOn: LedgerEntry['openedOn'] = (fileName) =>
  sqliteLedgerOpened({ optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName }), inMemory: false });

const carriedOn: LedgerEntry['carriedOn'] = async (fileName, carrying) => {
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    await sqliteLayoutCarried(pool, [], carrying);
  } finally {
    await pool.close();
  }
};

const onSQLite: LedgerEntry = {
  mostEventsInOneAppend: 8,
  afterClosing: 'Bounded connection pool has been closed',
  closedWhileWriting: 'TaskProcessor has been stopped',
  aDatabase: () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    return Promise.resolve(fileName);
  },
  ledgerOn: (fileName, runOutcomes, projections = []) =>
    ledgerLayer({ fileName, projections, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
  ledgerRaisingOn: (fileName, appended) => ledgerLayer({ fileName, appended }),
  storeOn: (fileName) => openedOn(fileName).store,
  openedOn,
  queried,
  executedOn,
  layout: sqliteLayout,
  carriedOn,
  definitionStreamsIndexed,
  planOf,
  throughTheKindIndex: 'USING INDEX ledger_first_messages_by_kind',
  throughTheIdIndex: 'USING INDEX ledger_messages_by_id',
  outcomeTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_outcomes_*' ORDER BY name",
  projectionTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_tallies_*' ORDER BY name",
  projectionIndexes: "SELECT name FROM sqlite_master WHERE type = 'index' AND name GLOB 'run_tallies_*' ORDER BY name",
  topicTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'topics_*' ORDER BY name",
};

describe('The ledger on SQLite', () => {
  ledgerBehaviour(onSQLite);
  logBehaviour(onSQLite);
  appendedFactsOnStoresBehaviour(onSQLite);
  earlierShapesBehaviour(onSQLite);
  databaseStructureBehaviour(onSQLite);
  knownFactsBehaviour(onSQLite);
  keptSecretsBehaviour({ ...onSQLite, secretRowsOn: (fileName) => sqliteSecretRows({ fileName }) });
});
