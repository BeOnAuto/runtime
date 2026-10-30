import { describe, expect, it } from 'vitest';

import { postgresqlStreamAges, streamAgeStatement } from './postgresql-stream-ages.ts';

describe('the age of the last append to a stream on PostgreSQL', () => {
  it('is read from the last message of the stream in the default partition, by the clock of the database', async () => {
    const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
    const answering = (rows: readonly unknown[]) =>
      postgresqlStreamAges((text, values) => {
        asked.push({ text, values });
        return Promise.resolve(rows);
      });

    expect([
      await answering([{ age: '1250' }]).ageOfLastAppend('runs/r1'),
      await answering([]).ageOfLastAppend('runs/r2'),
    ]).toEqual([1250, Number.POSITIVE_INFINITY]);
    expect(asked).toEqual([
      { text: streamAgeStatement, values: ['runs/r1', 'emt:default'] },
      { text: streamAgeStatement, values: ['runs/r2', 'emt:default'] },
    ]);
  });
});
