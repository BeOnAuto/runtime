import { Schema } from 'effect';

import type { ConnectionPorts, ReadRows } from '../connection/ledger-connection.ts';
import { lastAnswerOf, wroteARow, type StatementAnswer } from '../connection/statement-answers.ts';
import { statement, textOnPostgreSQL, type Statement, type StatementValue } from '../connection/statement.ts';
import type { LedgerStreams } from '../event-store.ts';

export interface Connection {
  query(text: string, values?: readonly StatementValue[]): Promise<StatementAnswer>;
  release(): void;
}

export interface Connections {
  query(text: string, values: readonly StatementValue[]): Promise<StatementAnswer>;
  connect(): Promise<Connection>;
}

const migrationLock = 7_461_239_041;

const NowRows = Schema.Tuple([Schema.Struct({ now: Schema.Union([Schema.Finite, Schema.FiniteFromString]) })]);

const clockRead = statement`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS now`;

function alwaysKept(): boolean {
  return true;
}

async function inTransaction(
  connections: Connections,
  statements: readonly Statement[],
  isKept: (last: StatementAnswer) => boolean,
): Promise<StatementAnswer> {
  const connection = await connections.connect();
  try {
    await connection.query('BEGIN');
    const last = await lastAnswerOf(statements, (asked) => connection.query(textOnPostgreSQL(asked), asked.values));
    await connection.query(isKept(last) ? 'COMMIT' : 'ROLLBACK');
    return last;
  } catch (failure) {
    await connection.query('ROLLBACK');
    throw failure;
  } finally {
    connection.release();
  }
}

async function snapshotOn(connections: Connections): Promise<Connection> {
  const connection = await connections.connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return connection;
  } catch (failure) {
    connection.release();
    throw failure;
  }
}

async function snapshotEnded(connection: Connection): Promise<void> {
  try {
    await connection.query('ROLLBACK');
  } finally {
    connection.release();
  }
}

function readsOn(connection: Connection): ReadRows {
  return async (asked) => (await connection.query(textOnPostgreSQL(asked), asked.values)).rows;
}

function snapshotsOn(connections: Connections): ConnectionPorts['readConsistently'] {
  const read = async <A>(reads: (read: ReadRows) => Promise<A>): Promise<A> => {
    const connection = await snapshotOn(connections);
    try {
      return await reads(readsOn(connection));
    } finally {
      await snapshotEnded(connection);
    }
  };
  return read;
}

export function postgresqlConnectionOn(connections: Connections, streams: LedgerStreams): ConnectionPorts {
  const query = async (asked: Statement) => (await connections.query(textOnPostgreSQL(asked), asked.values)).rows;
  return {
    dialect: 'postgresql',
    streams,
    read: query,
    write: query,
    transaction: async (statements) => (await inTransaction(connections, statements, wroteARow)).rows,
    readConsistently: snapshotsOn(connections),
    sharedClock: async () => {
      const [{ now }] = Schema.decodeUnknownSync(NowRows)(await query(clockRead));
      return now;
    },
    migrated: async (statements) => {
      await inTransaction(
        connections,
        [statement`SELECT pg_advisory_xact_lock(${migrationLock})`, ...statements],
        alwaysKept,
      );
    },
  };
}
