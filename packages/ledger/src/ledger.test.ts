import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { sqliteEventStore } from './index.ts';
import { definitionStreamsIndexed, planOf, queried } from './recorded/sqlite-checks.ts';
import { keptSecretsBehaviour } from './secrets/kept-secrets-behaviour.ts';
import { ledgerLayer, sqliteSecretRows } from './sqlite3.ts';
import { ledgerBehaviour } from './testing/ledger-behaviour.ts';
import type { LedgerEntry } from './testing/ledger-entry.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

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
  storeOn: (fileName) => sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName })),
  queried,
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
  keptSecretsBehaviour({ ...onSQLite, secretRowsOn: (fileName) => sqliteSecretRows({ fileName }) });
});
