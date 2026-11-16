import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { describe, onTestFinished } from 'vitest';

import {
  sqliteLayout,
  sqliteLedgerOpened,
  sqliteReceivedWebhooksOn,
  sqliteSecretRowsOn,
  VersionConflict,
} from './index.ts';
import { sqliteLayoutCarried } from './layout/sqlite-schema.ts';
import { pooledOptionsOf } from './sqlite-event-store.ts';
import { databaseStructureBehaviour } from './structure/database-structure-behaviour.ts';
import {
  appendedFactsOnStoresBehaviour,
  archivedStreamsBehaviour,
  definitionNamesBehaviour,
  appendsWithStatementsOnStoresBehaviour,
  measuredRiddenAppendsBehaviour,
  multiStreamAppendBehaviour,
  factScrubOnStoresBehaviour,
  earlierShapesBehaviour,
  keptSecretsBehaviour,
  receivedWebhooksBehaviour,
  knownFactsBehaviour,
  ledgerBehaviour,
  ledgerStepsBehaviour,
  logBehaviour,
  receivedWebhooksOfItsOpenLedger,
  secretRowsOfItsOpenLedger,
  sqliteUpdatesCountingOf,
  type LedgerEntry,
} from './testing/index.ts';
import { onEachSQLiteDriver, type OnASQLiteDriver } from './testing/sqlite-drivers.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

const sqliteDrivers = onEachSQLiteDriver(() => nodeSqliteDumboDriver);

function openedOnThe({ optionsOf }: OnASQLiteDriver): LedgerEntry['openedOn'] {
  return (fileName) => sqliteLedgerOpened({ optionsOf: () => optionsOf(fileName), inMemory: false });
}

function carriedOnThe({ optionsOf }: OnASQLiteDriver): LedgerEntry['carriedOn'] {
  return async (fileName, carrying) => {
    const { pool } = pooledOptionsOf(() => optionsOf(fileName));
    try {
      await sqliteLayoutCarried(pool, [], carrying);
    } finally {
      await pool.close();
    }
  };
}

const onSQLiteThrough = (sqlite: OnASQLiteDriver): LedgerEntry => ({
  mostEventsInOneAppend: 8,
  afterClosing: 'Bounded connection pool has been closed',
  closedWhileWriting: sqlite.closedWhileWriting,
  aDatabase: () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    return Promise.resolve(fileName);
  },
  ledgerOn: (fileName, runOutcomes, projections = [], holders) =>
    sqlite.ledgerLayer({ fileName, projections, runOutcomes, holders }),
  streamLedgerOn: (fileName, kept) => sqlite.ledgerLayer({ fileName, ...kept }),
  ledgerOutsideOn: (fileName, holders, content) => sqlite.ledgerLayer({ fileName, holders, content }),
  ledgerRaisingOn: (fileName, appended) => sqlite.ledgerLayer({ fileName, appended }),
  storeOn: (fileName) => openedOnThe(sqlite)(fileName).store,
  openedOn: openedOnThe(sqlite),
  queried: sqlite.queried,
  executedOn: sqlite.executedOn,
  layout: sqliteLayout,
  carriedOn: carriedOnThe(sqlite),
  definitionStreamsIndexed: sqlite.definitionStreamsIndexed,
  planOf: sqlite.planOf,
  statementPlanOf: sqlite.statementPlanOf,
  throughTheKindIndex: 'USING INDEX ledger_first_messages_by_kind',
  throughTheIdIndex: 'USING INDEX ledger_messages_by_org_and_id',
  throughTheTreeIndex: 'USING INDEX ledger_messages_by_org_and_correlation',
  throughTheExpiringIndex:
    'SEARCH recorded_content_heads USING INDEX recorded_content_heads_expiring (expires_at>? AND expires_at<?)',
  stepsOfAScanOrASort: ['SCAN recorded_content_heads', 'TEMP B-TREE'],
  throughTheUploadIndex: 'USING COVERING INDEX recorded_content_heads_by_upload',
  updatesCountingOf: sqliteUpdatesCountingOf,
  outcomeTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_outcomes_*' ORDER BY name",
  projectionTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_tallies_*' ORDER BY name",
  projectionIndexes: "SELECT name FROM sqlite_master WHERE type = 'index' AND name GLOB 'run_tallies_*' ORDER BY name",
  topicTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'topics_*' ORDER BY name",
  labelledTables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'label*' ORDER BY name",
});

describe.each(sqliteDrivers)('The ledger on SQLite through $through', (sqlite) => {
  const onSQLite = onSQLiteThrough(sqlite);
  ledgerBehaviour(onSQLite);
  logBehaviour(onSQLite);
  appendedFactsOnStoresBehaviour(onSQLite);
  factScrubOnStoresBehaviour(onSQLite);
  appendsWithStatementsOnStoresBehaviour(onSQLite);
  measuredRiddenAppendsBehaviour(onSQLite);
  earlierShapesBehaviour(onSQLite);
  databaseStructureBehaviour(onSQLite);
  knownFactsBehaviour(onSQLite);
  archivedStreamsBehaviour(onSQLite, {
    answered: new VersionConflict(),
    read: { version: 0, types: [] },
    rows: [{ archived: 1, facts: 2 }],
  });
  ledgerStepsBehaviour(onSQLite);
  keptSecretsBehaviour({
    ...onSQLite,
    secretRowsOn: (fileName) => secretRowsOfItsOpenLedger(sqlite.sqliteLedgerFile(fileName)),
  });
  receivedWebhooksBehaviour({
    ...onSQLite,
    receivedWebhooksOn: (fileName) => receivedWebhooksOfItsOpenLedger(sqlite.sqliteLedgerFile(fileName)),
  });
  multiStreamAppendBehaviour({
    ...onSQLite,
    storeKeeping: (fileName, kept) =>
      sqliteLedgerOpened({ optionsOf: () => sqlite.optionsOf(fileName), inMemory: false }, kept).store,
  });
  definitionNamesBehaviour({
    ...onSQLite,
    storeKeepingNames: (fileName, definitionNames) =>
      sqliteLedgerOpened({ optionsOf: () => sqlite.optionsOf(fileName), inMemory: false }, { definitionNames }).store,
  });
});

describe.each(sqliteDrivers)(
  'The secret rows on a pool of their own through $through, as code that opens the ledger on a driver of its own opens them',
  (sqlite) => {
    keptSecretsBehaviour({
      ...onSQLiteThrough(sqlite),
      secretRowsOn: (fileName) => sqliteSecretRowsOn(() => sqlite.optionsOf(fileName)),
    });
  },
);

describe.each(sqliteDrivers)(
  'The webhooks received on a pool of their own through $through, as code that opens the ledger on a driver of its own opens them',
  (sqlite) => {
    receivedWebhooksBehaviour({
      ...onSQLiteThrough(sqlite),
      receivedWebhooksOn: (fileName) => sqliteReceivedWebhooksOn(() => sqlite.optionsOf(fileName)),
    });
  },
);
