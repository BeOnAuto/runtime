import { sqliteMostBoundValues, statement, statementOf } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aSQLiteFile } from '../testing/host-files.ts';
import { hostDatabaseOpenedOn, type ClosingHostDatabase } from './ledger-connections.ts';

const table = statement`CREATE TABLE IF NOT EXISTS amounts (amount BIGINT NOT NULL)`;

function inserted(count: number) {
  const values = Array.from({ length: count }, (_, at) => at);
  return statementOf(
    [...values.map((_, at) => (at === 0 ? 'INSERT INTO amounts (amount) VALUES (' : '), (')), ')'],
    values,
  );
}

function summed(count: number) {
  const values = Array.from({ length: count }, (_, at) => at);
  return statementOf(
    [...values.map((_, at) => (at === 0 ? 'SELECT count(*) AS counted FROM amounts WHERE amount IN (' : ', ')), ')'],
    values,
  );
}

async function opened(mostBoundValues?: number): Promise<ClosingHostDatabase> {
  const database = await hostDatabaseOpenedOn({ store: 'sqlite', file: aSQLiteFile(), mostBoundValues }, [table]);
  onTestFinished(database.close);
  return database;
}

describe('a testing database whose engine allows fewer bound values', () => {
  it('names its bound, and runs each statement that binds no more', async () => {
    const database = await opened(3);

    await Effect.runPromise(database.write(inserted(3)));
    await Effect.runPromise(database.transaction([inserted(2), inserted(1)]));
    const read = await Effect.runPromise(database.read(summed(3)));
    const readConsistently = await Effect.runPromise(database.readConsistently((reads) => reads(summed(2))));

    expect([database.mostBoundValues, read, readConsistently]).toEqual([3, [{ counted: 6 }], [{ counted: 5 }]]);
  });

  it('refuses each statement that binds more, as such an engine does', async () => {
    const database = await opened(3);

    const refused = await Effect.runPromise(
      Effect.all([
        Effect.flip(database.write(inserted(4))),
        Effect.flip(database.transaction([inserted(1), inserted(4)])),
        Effect.flip(database.read(summed(4))),
        Effect.flip(database.readConsistently((reads) => reads(summed(4)))),
      ]),
    );

    expect(refused.map(({ detail }: { readonly detail: string }) => detail)).toEqual(
      refused.map(() => 'Error: too many SQL variables: a statement binds more than 3 values'),
    );
    expect(await Effect.runPromise(database.read(summed(1)))).toEqual([{ counted: 0 }]);
  });

  it('is the engine’s own, the Node SQLite host’s, where no bound is asked', async () => {
    const database = await opened();

    expect(database.mostBoundValues).toBe(sqliteMostBoundValues);
  });
});
