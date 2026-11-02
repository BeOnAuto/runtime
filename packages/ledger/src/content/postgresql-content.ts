import type { InTransaction, OwnContentStore, StatementExecutor } from '../event-store.ts';
import { formattedFor } from '../postgresql-reads/recorded-parts.ts';
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

export function executorOn(querying: Querying): StatementExecutor {
  const formatted = formattedFor(async (text, values) => (await querying.query(text, values)).rows);
  return { query: async (sql) => ({ rows: await formatted(sql) }), command: formatted };
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

export function postgresqlContentOn(connections: ContentConnections): OwnContentStore {
  return contentStoreOn(executorOn(connections), postgresqlContent);
}
