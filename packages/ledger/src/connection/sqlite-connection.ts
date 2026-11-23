import type { SQL } from '@event-driven-io/dumbo';

import { inTurn } from '../projections/inline-projection.ts';
import { appendsWithOn, type StreamsCarrying } from './appends-with.ts';
import type { ConnectionPorts, OpenedConnection, ReadRows } from './ledger-connection.ts';
import { lastAnswerOf, wroteARow, type StatementAnswer } from './statement-answers.ts';
import { sqlOf } from './statement.ts';

interface WriterTransaction {
  readonly execute: { readonly command: (sql: SQL) => Promise<StatementAnswer> };
}

interface ReaderTransaction {
  readonly execute: { readonly query: (sql: SQL) => Promise<StatementAnswer> };
}

type Handled<A> = { readonly success: boolean; readonly result: A };

interface SnapshotReader {
  readonly withTransaction: <A>(
    handle: (transaction: ReaderTransaction) => Promise<Handled<A>>,
    options: typeof deferred,
  ) => Promise<A>;
}

export interface SQLitePool {
  readonly execute: {
    readonly query: (sql: SQL) => Promise<StatementAnswer>;
    readonly command: (sql: SQL) => Promise<StatementAnswer>;
  };
  readonly withTransaction: <A>(
    handle: (transaction: WriterTransaction & ReaderTransaction) => Promise<Handled<A>>,
    options?: typeof deferred,
  ) => Promise<A>;
  readonly withConnection: <A>(
    handle: (reader: SnapshotReader) => Promise<A>,
    options: { readonly readonly: true },
  ) => Promise<A>;
}

export interface SQLiteConnecting {
  readonly inMemory: boolean;
  readonly streams: StreamsCarrying;
  readonly mostBoundValues: number;
}

const deferred = { mode: 'DEFERRED' } as const;

type QueryRows = (sql: SQL) => Promise<readonly unknown[]>;

export type ConsistentSQLiteReads = <A>(reads: (query: QueryRows) => Promise<A>) => Promise<A>;

function queryIn({ execute }: ReaderTransaction): QueryRows {
  return async (sql) => (await execute.query(sql)).rows;
}

export function sqliteConsistentReadsOn(pool: SQLitePool, inMemory: boolean): ConsistentSQLiteReads {
  const read = <A>(reads: (query: QueryRows) => Promise<A>) => {
    const handle = async (transaction: ReaderTransaction): Promise<Handled<A>> => ({
      success: true,
      result: await reads(queryIn(transaction)),
    });
    return inMemory
      ? pool.withTransaction(handle, deferred)
      : pool.withConnection((reader) => reader.withTransaction(handle, deferred), { readonly: true });
  };
  return read;
}

function snapshotsOn(pool: SQLitePool, inMemory: boolean): ConnectionPorts['readConsistently'] {
  const consistently = sqliteConsistentReadsOn(pool, inMemory);
  return (reads) => consistently((query) => reads((asked) => query(sqlOf(asked))));
}

export function sqliteConnectionOn(
  pool: SQLitePool,
  { inMemory, streams, mostBoundValues }: SQLiteConnecting,
): OpenedConnection {
  const write = async (asked: Parameters<ReadRows>[0]) => (await pool.execute.command(sqlOf(asked))).rows;
  return {
    dialect: 'sqlite',
    streams,
    appendWith: appendsWithOn(streams),
    read: async (asked) => (await pool.execute.query(sqlOf(asked))).rows,
    write,
    transaction: (statements) =>
      pool.withTransaction(async ({ execute }) => {
        const last = await lastAnswerOf(statements, (asked) => execute.command(sqlOf(asked)));
        return { success: wroteARow(last), result: last.rows };
      }),
    readConsistently: snapshotsOn(pool, inMemory),
    sharedClock: null,
    mostBoundValues,
    migrated: (statements) => inTurn(statements, write),
  };
}
