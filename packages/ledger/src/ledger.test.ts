import { dumbo } from '@event-driven-io/dumbo';
import { describe, onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriver } from './connection/node-sqlite-event-store-driver.ts';
import {
  sqliteLayout,
  sqliteLedgerOpened,
  sqliteReceivedWebhooksOn,
  sqliteSecretRowsOn,
  VersionConflict,
} from './index.ts';
import { sqliteLayoutCarried } from './layout/sqlite-schema.ts';
import { definitionStreamsIndexed, executedOn, planOf, queried, statementPlanOf } from './recorded/sqlite-checks.ts';
import { ledgerLayer, sqliteLedgerFile } from './sqlite.ts';
import { databaseStructureBehaviour } from './structure/database-structure-behaviour.ts';
import {
  appendedFactsOnStoresBehaviour,
  archivedStreamsBehaviour,
  definitionNamesBehaviour,
  definitionProjectionsOnStoresBehaviour,
  appendsWithStatementsOnStoresBehaviour,
  measuredRiddenAppendsBehaviour,
  multiStreamAppendBehaviour,
  factScrubOnStoresBehaviour,
  earlierShapesBehaviour,
  keptSecretsBehaviour,
  receivedWebhooksBehaviour,
  knownFactsBehaviour,
  ledgerBehaviour,
  logBehaviour,
  receivedWebhooksOfItsOpenLedger,
  runIdsOnStoresBehaviour,
  secretRowsOfItsOpenLedger,
  sqliteUpdatesCountingOf,
  type LedgerEntry,
  type NamingStores,
} from './testing/index.ts';
import { temporaryDatabase } from './testing/temporary-database.ts';

const openedOn: LedgerEntry['openedOn'] = (fileName) =>
  sqliteLedgerOpened({ optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false });

const carriedOn: LedgerEntry['carriedOn'] = async (fileName, carrying) => {
  const pool = dumbo(nodeSqliteEventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    await sqliteLayoutCarried(pool, [], carrying);
  } finally {
    await pool.close();
  }
};

const onSQLite: LedgerEntry = {
  mostEventsInOneAppend: 8,
  afterClosing: 'Bounded connection pool has been closed',
  closedWhileWriting: 'Writer connection pool has been closed',
  aDatabase: () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    return Promise.resolve(fileName);
  },
  ledgerOn: (fileName, runOutcomes, projections = [], kept = {}) =>
    ledgerLayer({ fileName, projections, runOutcomes, ...kept }),
  ledgerOutsideOn: (fileName, holders, content) => ledgerLayer({ fileName, holders, content }),
  ledgerRaisingOn: (fileName, appended) => ledgerLayer({ fileName, appended }),
  storeOn: (fileName) => openedOn(fileName).store,
  openedOn,
  queried,
  executedOn,
  layout: sqliteLayout,
  carriedOn,
  definitionStreamsIndexed,
  planOf,
  statementPlanOf,
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
};

const namingStoresOnSQLite: NamingStores = {
  aDatabase: onSQLite.aDatabase,
  storeOn: (fileName, projections, definitionNames) =>
    sqliteLedgerOpened(
      { optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false },
      { definitionNames, projections },
    ).store,
};

describe('The ledger on SQLite', () => {
  ledgerBehaviour(onSQLite);
  runIdsOnStoresBehaviour({
    aDatabase: onSQLite.aDatabase,
    storeOn: (fileName, runIds) =>
      sqliteLedgerOpened(
        { optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false },
        { runIds },
      ).store,
  });
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
  keptSecretsBehaviour({
    ...onSQLite,
    secretRowsOn: (fileName) => secretRowsOfItsOpenLedger(sqliteLedgerFile(fileName)),
  });
  receivedWebhooksBehaviour({
    ...onSQLite,
    receivedWebhooksOn: (fileName) => receivedWebhooksOfItsOpenLedger(sqliteLedgerFile(fileName)),
  });
  multiStreamAppendBehaviour({
    ...onSQLite,
    storeKeeping: (fileName, kept) =>
      sqliteLedgerOpened({ optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false }, kept)
        .store,
  });
  definitionNamesBehaviour({
    ...onSQLite,
    storeKeepingNames: (fileName, definitionNames) =>
      sqliteLedgerOpened(
        { optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false },
        { definitionNames },
      ).store,
  });
  definitionProjectionsOnStoresBehaviour(namingStoresOnSQLite);
});

describe('The secret rows on a pool of their own, as code that opens the ledger on a driver of its own opens them', () => {
  keptSecretsBehaviour({
    ...onSQLite,
    secretRowsOn: (fileName) => sqliteSecretRowsOn(() => ({ driver: nodeSqliteEventStoreDriver, fileName })),
  });
});

describe('The webhooks received on a pool of their own, as code that opens the ledger on a driver of its own opens them', () => {
  receivedWebhooksBehaviour({
    ...onSQLite,
    receivedWebhooksOn: (fileName) =>
      sqliteReceivedWebhooksOn(() => ({ driver: nodeSqliteEventStoreDriver, fileName })),
  });
});
