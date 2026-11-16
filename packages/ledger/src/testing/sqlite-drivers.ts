import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriverOf } from '../connection/node-sqlite-event-store-driver.ts';
import { sqliteFileLedgerOn, type SQLiteFileDriver, type SQLiteFileLedger } from '../connection/sqlite-file-ledger.ts';
import { layoutWritten } from '../layout/layout-kept.ts';
import { sqliteChecksOn, type SQLiteChecks } from '../recorded/sqlite-checks.ts';
import * as theAddOnsEntry from '../sqlite3.ts';
import { temporaryDatabase } from './temporary-database.ts';

export interface SQLiteFileOptions {
  readonly driver: SQLiteFileDriver;
  readonly fileName: string;
}

export interface OnASQLiteDriver extends SQLiteFileLedger, SQLiteChecks {
  readonly through: string;
  readonly closedWhileWriting: string;
  readonly optionsOf: (fileName: string) => SQLiteFileOptions;
  readonly aDatabaseFile: () => string;
  readonly aSQLiteFileInLayout: (fileName: string, layout: number) => Promise<void>;
  readonly anEmmettStoreInMemory: () => ReturnType<typeof getSQLiteEventStore>;
}

interface TheDriver {
  readonly through: string;
  readonly theDriver: () => SQLiteFileDriver;
  readonly closedWhileWriting: string;
  readonly ledger: SQLiteFileLedger;
  readonly checks: SQLiteChecks;
  readonly aSQLiteFileInLayout: OnASQLiteDriver['aSQLiteFileInLayout'];
}

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

function onTheDriver({
  through,
  theDriver,
  closedWhileWriting,
  ledger,
  checks,
  aSQLiteFileInLayout,
}: TheDriver): OnASQLiteDriver {
  return {
    through,
    closedWhileWriting,
    ...ledger,
    ...checks,
    optionsOf: (fileName) => ({ driver: theDriver(), fileName }),
    aDatabaseFile,
    aSQLiteFileInLayout,
    anEmmettStoreInMemory: () => {
      const store = getSQLiteEventStore({
        driver: theDriver(),
        fileName: ':memory:',
        schema: { autoMigration: 'None' },
      });
      onTestFinished(() => store.close());
      return store;
    },
  };
}

function onNodeSqlite(theDumboDriver: () => typeof nodeSqliteDumboDriver): OnASQLiteDriver {
  const theDriver = () => nodeSqliteEventStoreDriverOf(theDumboDriver);
  const checks = sqliteChecksOn(theDriver);
  return onTheDriver({
    through: 'node:sqlite',
    theDriver,
    closedWhileWriting: 'Writer connection pool has been closed',
    ledger: sqliteFileLedgerOn(theDriver),
    checks,
    aSQLiteFileInLayout: (fileName, layout) => checks.executedOn(fileName, (execute) => layoutWritten(execute, layout)),
  });
}

export function onEachSQLiteDriver(
  theNodeSqliteDumboDriver: () => typeof nodeSqliteDumboDriver,
): readonly OnASQLiteDriver[] {
  return [
    onTheDriver({
      through: 'the sqlite3 add-on',
      theDriver: () => sqlite3EventStoreDriver,
      closedWhileWriting: 'TaskProcessor has been stopped',
      ledger: theAddOnsEntry,
      checks: sqliteChecksOn(() => sqlite3EventStoreDriver),
      aSQLiteFileInLayout: theAddOnsEntry.aSQLiteFileInLayout,
    }),
    onNodeSqlite(theNodeSqliteDumboDriver),
  ];
}
