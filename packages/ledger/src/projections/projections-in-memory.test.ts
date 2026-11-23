import { SQL } from '@event-driven-io/dumbo';
import { memoryLedger } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { readsAsTheyCome } from './projection-reads.ts';
import { projectionsBehaviour } from './projections-behaviour.ts';

describe('The in-memory ledger of the application layer', () => {
  projectionsBehaviour((projections) => Promise.resolve(memoryLedger(undefined, projections).service));
});

describe('the reads of a store that takes its reads as they come', () => {
  it('go to the store’s own query, one by one', async () => {
    const asked: SQL[] = [];
    const query = (sql: SQL) => {
      asked.push(sql);
      return Promise.resolve([{ n: asked.length }]);
    };

    const read = await readsAsTheyCome(query)(async (each) => [
      ...(await each(SQL`SELECT 1`)),
      ...(await each(SQL`SELECT 2`)),
    ]);

    expect([read, asked.length]).toEqual([[{ n: 1 }, { n: 2 }], 2]);
  });
});
