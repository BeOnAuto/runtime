import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from '../sqlite3.ts';
import { openConnectionWith, type OpenConnection } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { valuesListOf } from '../testing/values-list.ts';
import { chunksWithin, itemsInAStatement, sqliteMostBoundValues } from './bound-values.ts';
import { sqliteLedgerLayer, sqliteLedgerOpened } from './sqlite-opening.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

async function opened(layer: Parameters<typeof openConnectionWith>[0]): Promise<OpenConnection> {
  const connection = await openConnectionWith(layer);
  onTestFinished(connection.dispose);
  return connection;
}

describe('the items of a statement within the values its database allows', () => {
  it('are as many as fit beside the values the statement binds anyway, in chunks of that many in order', () => {
    const bound = { mostBoundValues: 10, valuesEach: 2, valuesBeside: 2 };

    expect(itemsInAStatement(bound)).toBe(4);
    expect(chunksWithin(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], bound)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
      ['i'],
    ]);
    expect(chunksWithin(['a', 'b'], { mostBoundValues: 10, valuesEach: 9 })).toEqual([['a'], ['b']]);
    expect(chunksWithin([], bound)).toEqual([]);
  });

  it('are refused when not one item fits beside the values the statement binds anyway', () => {
    expect(() => itemsInAStatement({ mostBoundValues: 10, valuesEach: 9, valuesBeside: 2 })).toThrow(
      'A statement that binds 2 values beside 9 for each item binds more than the 10 its database allows',
    );
  });

  it.each<readonly [string, Parameters<typeof itemsInAStatement>[0], string]>([
    [
      'a bound of no values',
      { mostBoundValues: 0, valuesEach: 1 },
      'most values a statement may bind is a whole number of at least 1, not 0',
    ],
    [
      'a bound that is no whole number',
      { mostBoundValues: 9.5, valuesEach: 1 },
      'most values a statement may bind is a whole number of at least 1, not 9.5',
    ],
    [
      'items that bind no values',
      { mostBoundValues: 10, valuesEach: 0 },
      'count of values a statement binds for each item is a whole number of at least 1, not 0',
    ],
    [
      'items that bind part of a value',
      { mostBoundValues: 10, valuesEach: 1.5 },
      'count of values a statement binds for each item is a whole number of at least 1, not 1.5',
    ],
    [
      'fewer than no values beside the items',
      { mostBoundValues: 10, valuesEach: 1, valuesBeside: -1 },
      'count of values a statement binds beside its items is a whole number of at least 0, not -1',
    ],
  ])('are refused for %s, so that no item is lost to a count the bound does not hold', (_case, bound, refusal) => {
    expect(() => itemsInAStatement(bound)).toThrow(refusal);
  });
});

describe('the most values a statement binds on the Node SQLite host', () => {
  it('are 32,766, which its SQLite takes in one statement, refusing one more', async () => {
    const { connection } = await opened(ledgerLayer({ fileName: aDatabaseFile() }));

    expect(connection.mostBoundValues).toBe(sqliteMostBoundValues);
    expect(await connection.read(valuesListOf(sqliteMostBoundValues))).toEqual([{ counted: sqliteMostBoundValues }]);
    await expect(connection.read(valuesListOf(sqliteMostBoundValues + 1))).rejects.toThrow('too many SQL variables');
  });

  it('are those its opening names, for a host whose SQLite allows fewer', async () => {
    const fileName = aDatabaseFile();
    const { connection } = await opened(
      sqliteLedgerLayer({
        optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName }),
        inMemory: false,
        mostBoundValues: 100,
      }),
    );

    expect(connection.mostBoundValues).toBe(100);
  });

  it('are refused below the 100 the ledger binds in one statement on any SQLite', () => {
    const fileName = aDatabaseFile();

    expect(() =>
      sqliteLedgerOpened({
        optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName }),
        inMemory: false,
        mostBoundValues: 99,
      }),
    ).toThrow('A SQLite that binds at most 99 values in a statement holds no ledger, which binds up to 100 there');
  });
});
