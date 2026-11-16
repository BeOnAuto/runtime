import {
  createSingletonConnectionPool,
  type ConnectionPool,
  type PoolCloseOptions,
  type QueryResultRow,
  type SQL,
  type TransactionResult,
} from '@event-driven-io/dumbo';

import {
  nodeSqliteDriverType,
  type NodeSqliteConnection,
  type NodeSqliteTransaction,
} from '../client/node-sqlite-connection.ts';
import type {
  NodeSqliteTransactionOptions,
  ReadonlyAbortContext,
  ReadonlyBatchCommandOptions,
  ReadonlyConnectionOptions,
  ReadonlyStatementOptions,
} from '../client/readonly-options.ts';
import type { ConnectionContext } from './connection-context.ts';
import { writerQueue, type WriterQueue } from './writer-queue.ts';

export type NodeSqlitePool = ConnectionPool<NodeSqliteConnection>;

type Handle<Result> = (connection: NodeSqliteConnection, context: ReadonlyAbortContext) => Promise<Result>;

type TransactionHandle<Result> = (
  transaction: NodeSqliteTransaction,
  context: ReadonlyAbortContext,
) => Promise<TransactionResult<Result> | Result>;

export interface WriterPoolOptions {
  readonly getConnection: (context: ReadonlyAbortContext) => NodeSqliteConnection | Promise<NodeSqliteConnection>;
  readonly context: ConnectionContext;
  readonly maxTaskIdleTime?: number | undefined;
}

interface Writer {
  readonly inner: Readonly<NodeSqlitePool>;
  readonly queue: WriterQueue;
  readonly context: ConnectionContext;
}

const mostWaitingForTheWriter = 1000;

const longestWaitForTheWriterToStart = 30_000;

function onTheWriter<Result>(
  { inner, queue, context }: Writer,
  handle: Handle<Result>,
  options?: ReadonlyConnectionOptions,
): Promise<Result> {
  const active = context.active();
  return active === undefined
    ? queue.run((abort) => inner.withConnection((connection) => handle(connection, abort), options), options)
    : inner.withConnection((_connection, abort: ReadonlyAbortContext) => handle(active, abort), options);
}

function transactionAware(connection: NodeSqliteConnection, context: ConnectionContext): NodeSqliteConnection {
  return {
    ...connection,
    withTransaction: (handle, options) =>
      context.inItsContext(connection, () => connection.withTransaction(handle, options)),
  };
}

function withWriterConnection<Result>(
  writer: Writer,
  handle: Handle<Result>,
  options?: ReadonlyConnectionOptions,
): Promise<Result> {
  return onTheWriter(
    writer,
    (connection, abort) =>
      writer.context.inItsContext(connection, () => handle(transactionAware(connection, writer.context), abort)),
    options,
  );
}

function inTransactionOf<Result>(
  connection: NodeSqliteConnection,
  handle: TransactionHandle<Result>,
  abort: ReadonlyAbortContext,
  options?: NodeSqliteTransactionOptions,
): Promise<Result> {
  return connection.withTransaction((transaction) => handle(transaction, abort), options);
}

function withWriterTransaction<Result>(
  writer: Writer,
  handle: TransactionHandle<Result>,
  options?: NodeSqliteTransactionOptions,
): Promise<Result> {
  const active = writer.context.active();
  return active === undefined
    ? onTheWriter(
        writer,
        (connection, abort) =>
          writer.context.inItsContext(connection, () => inTransactionOf(connection, handle, abort, options)),
        options,
      )
    : writer.inner.withConnection(
        (_connection, abort: ReadonlyAbortContext) => inTransactionOf(active, handle, abort, options),
        options,
      );
}

export function writerPool({ getConnection, context, maxTaskIdleTime }: WriterPoolOptions): NodeSqlitePool {
  const inner = createSingletonConnectionPool({ driverType: nodeSqliteDriverType, getConnection });
  const writer: Writer = {
    inner,
    queue: writerQueue({
      mostWaiting: mostWaitingForTheWriter,
      longestWaitToStart: maxTaskIdleTime ?? longestWaitForTheWriterToStart,
    }),
    context,
  };
  const reader = () => context.active() ?? inner;
  return {
    driverType: nodeSqliteDriverType,
    connection: (options?: ReadonlyConnectionOptions) => inner.connection(options),
    transaction: (options) => inner.transaction(options),
    withConnection: (handle, options?: ReadonlyConnectionOptions) =>
      context.active() !== undefined || options?.readonly !== true
        ? withWriterConnection(writer, handle, options)
        : inner.withConnection(handle, options),
    withTransaction: (handle, options) => withWriterTransaction(writer, handle, options),
    execute: {
      query: <Result extends QueryResultRow>(sql: SQL, options?: ReadonlyStatementOptions) =>
        reader().execute.query<Result>(sql, options),
      batchQuery: <Result extends QueryResultRow>(sqls: Iterable<SQL>, options?: ReadonlyStatementOptions) =>
        reader().execute.batchQuery<Result>([...sqls], options),
      command: <Result extends QueryResultRow>(sql: SQL, options?: ReadonlyStatementOptions) =>
        onTheWriter(writer, (connection) => connection.execute.command<Result>(sql, options), options),
      batchCommand: <Result extends QueryResultRow>(sqls: Iterable<SQL>, options?: ReadonlyBatchCommandOptions) =>
        onTheWriter(writer, (connection) => connection.execute.batchCommand<Result>([...sqls], options), options),
    },
    close: async (options?: Readonly<PoolCloseOptions>) => {
      await writer.queue.stop(options);
      await inner.close(options);
    },
  };
}
