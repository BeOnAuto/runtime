import type { JSONSerializer, SQLExecutor, TransactionResult } from '@event-driven-io/dumbo';
import { sqliteConnection, type SQLiteDriverType, type SQLiteTransactionMode } from '@event-driven-io/dumbo/sqlite';

import { nodeSqliteClient, type NodeSqliteClient, type NodeSqliteClientOptions } from './node-sqlite-client.ts';
import type { NodeSqliteTransactionOptions, ReadonlyAbortContext } from './readonly-options.ts';

export const nodeSqliteDriverType = 'SQLite:node-sqlite' satisfies SQLiteDriverType;

export type NodeSqliteDriverType = typeof nodeSqliteDriverType;

type InTransaction = <Result = never>(
  handle: (
    transaction: NodeSqliteTransaction,
    context: ReadonlyAbortContext,
  ) => Promise<TransactionResult<Result> | Result>,
  options?: NodeSqliteTransactionOptions,
) => Promise<Result>;

export interface NodeSqliteTransaction {
  readonly driverType: NodeSqliteDriverType;
  readonly connection: NodeSqliteConnection;
  readonly begin: () => Promise<void>;
  readonly commit: () => Promise<void>;
  readonly rollback: (error?: unknown) => Promise<void>;
  readonly execute: SQLExecutor;
  readonly withTransaction: InTransaction;
  readonly _transactionOptions: NodeSqliteTransactionOptions;
}

export interface NodeSqliteConnection {
  readonly driverType: NodeSqliteDriverType;
  readonly open: (context?: ReadonlyAbortContext) => Promise<NodeSqliteClient>;
  readonly close: () => Promise<void>;
  readonly execute: SQLExecutor;
  readonly transaction: (options?: NodeSqliteTransactionOptions) => NodeSqliteTransaction;
  readonly withTransaction: InTransaction;
  readonly _transactionType: NodeSqliteTransaction;
}

export interface NodeSqliteConnectionOptions extends NodeSqliteClientOptions {
  readonly defaultTransactionMode?: SQLiteTransactionMode;
  readonly transactionOptions?: NodeSqliteTransactionOptions;
  readonly readonly?: boolean;
}

export function nodeSqliteConnection(
  options: NodeSqliteConnectionOptions & { readonly serializer: JSONSerializer },
): NodeSqliteConnection {
  return sqliteConnection<NodeSqliteConnection, NodeSqliteConnectionOptions>({
    type: 'Client',
    driverType: nodeSqliteDriverType,
    sqliteClientFactory: (connectionOptions) => nodeSqliteClient(connectionOptions),
    connectionOptions: options,
    serializer: options.serializer,
  });
}
