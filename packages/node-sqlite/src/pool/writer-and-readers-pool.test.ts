import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aDatabaseFile } from '../testing/temporary-files.ts';
import { nodeSqlitePool } from './node-sqlite-pool.ts';

async function notesIn(execute: SQLExecutor): Promise<readonly unknown[]> {
  return (await execute.query(SQL`SELECT note FROM notes ORDER BY note`)).rows;
}

async function aPoolOfTwoReaders() {
  const pool = nodeSqlitePool({
    fileName: aDatabaseFile(),
    readerPoolSize: 2,
    transactionOptions: { allowNestedTransactions: true },
  });
  onTestFinished(() => pool.close());
  await pool.execute.command(SQL`CREATE TABLE IF NOT EXISTS notes (note TEXT)`);
  return pool;
}

describe('the readers a pool of node:sqlite on a file holds for a connection', () => {
  it.each([2, 3])(
    'answers %i readers held at once, each reading a statement of its own outside its connection, with two readers',
    async (held) => {
      const pool = await aPoolOfTwoReaders();

      const answered = await Promise.all(
        Array.from({ length: held }, () =>
          pool.withConnection(async ({ execute }) => [await notesIn(execute), await notesIn(pool.execute)], {
            readonly: true,
          }),
        ),
      );

      expect(answered).toEqual(Array.from({ length: held }, () => [[], []]));
    },
  );
});
