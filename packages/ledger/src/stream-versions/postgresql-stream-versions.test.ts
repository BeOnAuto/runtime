import { describe, expect, it } from 'vitest';

import { postgresqlStreamVersions, streamVersionStatement } from './postgresql-stream-versions.ts';

describe('the version of a stream on PostgreSQL', () => {
  it('is read from the stream itself in the default partition, as text, and none for a stream never appended to', async () => {
    const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
    const answering = (rows: readonly unknown[]) =>
      postgresqlStreamVersions((text, values) => {
        asked.push({ text, values });
        return Promise.resolve(rows);
      });

    expect([
      await answering([{ version: '3' }]).versionOf('runs/r1'),
      await answering([]).versionOf('runs/r2'),
    ]).toEqual([3, 0]);
    expect(asked).toEqual([
      { text: streamVersionStatement, values: ['runs/r1', 'emt:default'] },
      { text: streamVersionStatement, values: ['runs/r2', 'emt:default'] },
    ]);
  });
});
