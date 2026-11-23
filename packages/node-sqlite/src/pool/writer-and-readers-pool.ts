import { cpus } from 'node:os';

import {
  createBoundedConnectionPool,
  type PoolCloseOptions,
  type QueryResultRow,
  type SQL,
} from '@event-driven-io/dumbo';

import {
  nodeSqliteDriverType,
  type NodeSqliteConnection,
  type NodeSqliteConnectionOptions,
} from '../client/node-sqlite-connection.ts';
import type {
  ReadonlyAbortContext,
  ReadonlyBatchCommandOptions,
  ReadonlyConnectionOptions,
  ReadonlyStatementOptions,
} from '../client/readonly-options.ts';
import type { ConnectionContext } from './connection-context.ts';
import { turnsOf } from './turns.ts';
import { writerPool, type NodeSqlitePool } from './writer-pool.ts';

export interface WriterAndReadersOptions {
  readonly connectionOf: (options: NodeSqliteConnectionOptions) => NodeSqliteConnection;
  readonly connectionOptions: NodeSqliteConnectionOptions;
  readonly context: ConnectionContext;
  readonly readerPoolSize?: number | undefined;
  readonly maxTaskIdleTime?: number | undefined;
  readonly onWaitingForTheWriter?: (() => void) | undefined;
}

interface Opening {
  readonly connectionOf: (options: NodeSqliteConnectionOptions) => NodeSqliteConnection;
  readonly connectionOptions: NodeSqliteConnectionOptions;
  readonly databaseReady: () => Promise<void>;
}

const leastReaders = 4;

function onceReady(prepare: () => Promise<void>): () => Promise<void> {
  const kept: { preparing?: Promise<void> } = {};
  return () => {
    kept.preparing ??= prepare().catch((error: unknown) => {
      delete kept.preparing;
      throw error;
    });
    return kept.preparing;
  };
}

async function databasePrepared({ connectionOf, connectionOptions }: Omit<Opening, 'databaseReady'>): Promise<void> {
  const first = connectionOf({ ...connectionOptions, skipDatabasePragmas: false, readonly: false });
  try {
    await first.open();
  } finally {
    await first.close();
  }
}

async function opened(
  { connectionOf, connectionOptions, databaseReady }: Opening,
  readonly: boolean,
  abort: ReadonlyAbortContext,
): Promise<NodeSqliteConnection> {
  await databaseReady();
  const connection = connectionOf({ ...connectionOptions, skipDatabasePragmas: true, readonly });
  await connection.open(abort);
  return connection;
}

function openingOf(connectionOf: Opening['connectionOf'], connectionOptions: NodeSqliteConnectionOptions): Opening {
  return {
    connectionOf,
    connectionOptions,
    databaseReady: onceReady(() => databasePrepared({ connectionOf, connectionOptions })),
  };
}

export function writerAndReadersPool({
  connectionOf,
  connectionOptions,
  context,
  readerPoolSize = Math.max(leastReaders, cpus().length),
  maxTaskIdleTime,
  onWaitingForTheWriter,
}: WriterAndReadersOptions): NodeSqlitePool {
  const opening = openingOf(connectionOf, connectionOptions);
  const writer = writerPool({
    getConnection: (abort) => opened(opening, false, abort),
    context,
    maxTaskIdleTime,
    onWaitingForTheWriter,
  });
  const readers = createBoundedConnectionPool({
    driverType: nodeSqliteDriverType,
    getConnection: (abort: ReadonlyAbortContext) => opened(opening, true, abort),
    maxConnections: readerPoolSize,
  });
  const heldReaders = turnsOf(Math.max(1, readerPoolSize - 1));
  const readsAReader = (options?: ReadonlyConnectionOptions) =>
    options?.readonly === true && context.active() === undefined;
  const forReading = (options?: ReadonlyConnectionOptions) => (readsAReader(options) ? readers : writer);
  const forQueries = () => (context.active() === undefined ? readers : writer);
  return {
    driverType: nodeSqliteDriverType,
    connection: (options?: ReadonlyConnectionOptions) => forReading(options).connection(options),
    withConnection: (handle, options?: ReadonlyConnectionOptions) =>
      readsAReader(options)
        ? heldReaders.taken(() => readers.withConnection(handle, options))
        : writer.withConnection(handle, options),
    transaction: (options) => writer.transaction(options),
    withTransaction: (handle, options) => writer.withTransaction(handle, options),
    execute: {
      query: <Result extends QueryResultRow>(sql: SQL, options?: ReadonlyStatementOptions) =>
        forQueries().execute.query<Result>(sql, options),
      batchQuery: <Result extends QueryResultRow>(sqls: Iterable<SQL>, options?: ReadonlyStatementOptions) =>
        forQueries().execute.batchQuery<Result>([...sqls], options),
      command: <Result extends QueryResultRow>(sql: SQL, options?: ReadonlyStatementOptions) =>
        writer.execute.command<Result>(sql, options),
      batchCommand: <Result extends QueryResultRow>(sqls: Iterable<SQL>, options?: ReadonlyBatchCommandOptions) =>
        writer.execute.batchCommand<Result>([...sqls], options),
    },
    close: async (options?: Readonly<PoolCloseOptions>) => {
      await Promise.all([writer.close(options), readers.close(options)]);
    },
  };
}
