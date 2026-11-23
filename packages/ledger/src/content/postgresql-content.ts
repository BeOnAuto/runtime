import { SQL } from '@event-driven-io/dumbo';
import { Effect, Semaphore } from 'effect';

import type { InTransaction, OwnContentStore, ReturningExecutor } from '../event-store.ts';
import { countedIn, formattedFor } from '../postgresql-reads/recorded-parts.ts';
import type { ConsistentReads } from '../projections/projection-reads.ts';
import { postgresqlContent } from './content-dialects.ts';
import { contentStoreOn } from './content-store.ts';

interface Answer {
  readonly rows: readonly unknown[];
}

interface Querying {
  query(text: string, values: readonly unknown[]): Promise<Answer>;
}

export interface ContentConnection extends Querying {
  release(): void;
}

export interface ContentConnections extends Querying {
  connect(): Promise<ContentConnection>;
}

export function executorOn(querying: Querying): ReturningExecutor {
  const formatted = formattedFor(async (text, values) => (await querying.query(text, values)).rows);
  const answered = async (sql: SQL) => ({ rows: await formatted(sql) });
  return { query: answered, command: answered };
}

export function inTransactionOn(connections: ContentConnections): InTransaction {
  return async (work) => {
    const connection = await connections.connect();
    try {
      await connection.query('BEGIN', []);
      const done = await work(executorOn(connection));
      await connection.query('COMMIT', []);
      return done;
    } catch (failure) {
      await connection.query('ROLLBACK', []);
      throw failure;
    } finally {
      connection.release();
    }
  };
}

export function snapshotsOn(connections: ContentConnections): ConsistentReads {
  return async (reads) => {
    const connection = await connections.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', []);
      const read = await reads(
        formattedFor(countedIn(async (text, values) => (await connection.query(text, values)).rows)),
      );
      await connection.query('COMMIT', []);
      return read;
    } catch (failure) {
      await connection.query('ROLLBACK', []);
      throw failure;
    } finally {
      connection.release();
    }
  };
}

const snapshotTurns = new WeakMap<ContentConnections, Semaphore.Semaphore>();

export function snapshotsTakenInTurn(pool: ContentConnections, mostAtOnce: number): ConsistentReads {
  const turns = snapshotTurns.get(pool) ?? Semaphore.makeUnsafe(mostAtOnce);
  snapshotTurns.set(pool, turns);
  const snapshots = snapshotsOn(pool);
  return (reads) => Effect.runPromise(turns.withPermit(Effect.promise(() => snapshots(reads))));
}

export function postgresqlContentOn(connections: ContentConnections): OwnContentStore {
  return contentStoreOn(executorOn(connections), postgresqlContent);
}

export async function postgresqlPlanOf(querying: Querying, statement: SQL): Promise<string> {
  const execute = executorOn(querying);
  await execute.command(SQL`SET enable_seqscan = off`);
  await execute.command(SQL`SET enable_sort = off`);
  return JSON.stringify((await execute.query(SQL`EXPLAIN ${statement}`)).rows);
}
