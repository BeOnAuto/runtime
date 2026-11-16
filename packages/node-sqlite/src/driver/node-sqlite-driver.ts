import {
  canHandleDriverWithConnectionString,
  dumboDatabaseDriverRegistry,
  type DumboDatabaseDriver,
} from '@event-driven-io/dumbo';
import {
  DefaultSQLiteMigratorOptions,
  SQLiteConnectionString,
  sqliteFormatter,
  sqliteMetadata,
} from '@event-driven-io/dumbo/sqlite';

import { nodeSqliteDriverType, type NodeSqliteConnection } from '../client/node-sqlite-connection.ts';
import { nodeSqlitePool, type NodeSqlitePoolOptions } from '../pool/node-sqlite-pool.ts';
import type { NodeSqlitePool } from '../pool/writer-pool.ts';

function parsedConnectionString(connectionString: string): string | null {
  try {
    return SQLiteConnectionString(connectionString);
  } catch {
    return null;
  }
}

export const nodeSqliteDumboDriver = {
  driverType: nodeSqliteDriverType,
  createPool: (options: NodeSqlitePoolOptions) => nodeSqlitePool(options),
  sqlFormatter: sqliteFormatter,
  defaultMigratorOptions: DefaultSQLiteMigratorOptions,
  canHandle: canHandleDriverWithConnectionString(nodeSqliteDriverType, parsedConnectionString),
  databaseMetadata: sqliteMetadata,
} satisfies DumboDatabaseDriver<NodeSqliteConnection, NodeSqlitePoolOptions, NodeSqlitePool>;

dumboDatabaseDriverRegistry.register(nodeSqliteDriverType, nodeSqliteDumboDriver);
