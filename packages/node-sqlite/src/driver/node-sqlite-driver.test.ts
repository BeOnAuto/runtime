import { SQL, dumbo, dumboDatabaseDriverRegistry } from '@event-driven-io/dumbo';
import { DefaultSQLiteMigratorOptions, sqliteFormatter, sqliteMetadata } from '@event-driven-io/dumbo/sqlite';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aDatabaseFile } from '../testing/temporary-files.ts';
import { nodeSqliteDumboDriver } from './node-sqlite-driver.ts';

describe('the node:sqlite driver of the event store library', () => {
  it('is registered under its type, SQLite:node-sqlite, as the library registers its own drivers', async () => {
    const pool = dumbo({ driverType: 'SQLite:node-sqlite', fileName: aDatabaseFile() });
    onTestFinished(() => pool.close());

    const { rows } = await pool.execute.query(SQL`SELECT sqlite_version() AS version`);

    expect(dumboDatabaseDriverRegistry.tryGet({ driverType: 'SQLite:node-sqlite' })).toBe(nodeSqliteDumboDriver);
    expect(JSON.stringify(rows)).toMatch(/^\[\{"version":"3\.\d+\.\d+"\}\]$/u);
  });

  it('opens a pool when it is handed to the library directly', async () => {
    const pool = dumbo({ driver: nodeSqliteDumboDriver, fileName: ':memory:' });
    onTestFinished(() => pool.close());

    expect((await pool.execute.query(SQL`SELECT 1 AS one`)).rows).toEqual([{ one: 1 }]);
  });

  it('uses the library’s own SQLite formatter, migrator options and metadata', () => {
    expect(nodeSqliteDumboDriver).toMatchObject({
      driverType: 'SQLite:node-sqlite',
      sqlFormatter: sqliteFormatter,
      defaultMigratorOptions: DefaultSQLiteMigratorOptions,
      databaseMetadata: sqliteMetadata,
    });
  });

  it('handles its own type and a SQLite connection string, and nothing else, as the library’s drivers do', () => {
    expect([
      nodeSqliteDumboDriver.canHandle({ driverType: 'SQLite:node-sqlite' }),
      nodeSqliteDumboDriver.canHandle({ connectionString: 'file:/a/ledger.db' }),
      nodeSqliteDumboDriver.canHandle({ connectionString: ':memory:' }),
      nodeSqliteDumboDriver.canHandle({ connectionString: 'postgresql://localhost/ledger' }),
      nodeSqliteDumboDriver.canHandle({}),
    ]).toEqual([true, true, true, false, false]);
  });
});
