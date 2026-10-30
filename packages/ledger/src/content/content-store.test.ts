import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { mostContentChunkBytes, sha256Of, textOfContent, textToKeep } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor, TransactionalPool } from '../event-store.ts';
import { sqliteContentOn } from './content-store.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Recording {
  readonly pool: TransactionalPool;
  readonly statements: readonly string[];
}

function recordingAnswering(rowsOf: (statement: string) => readonly unknown[]): Recording {
  const statements: string[] = [];
  const execute: StatementExecutor = {
    query: (sql) => {
      const statement = described(sql);
      statements.push(statement);
      return Promise.resolve({ rows: rowsOf(statement) });
    },
    command: (sql) => {
      statements.push(described(sql));
      return Promise.resolve();
    },
  };
  return {
    statements,
    pool: {
      execute,
      withTransaction: async (handle) => {
        statements.push('BEGIN');
        const done = await handle({ execute });
        statements.push('COMMIT');
        return done;
      },
    },
  };
}

function recordingFinding(heads: readonly unknown[]): Recording {
  return recordingAnswering(() => heads);
}

function recordingHoldingOneChunk(data: unknown): Recording {
  return recordingAnswering((statement) => (statement.startsWith('SELECT data') ? [{ data }] : [headOf('upload')]));
}

function kindsOf({ statements }: Recording): readonly string[] {
  return statements.map((statement) => statement.split(' ').slice(0, 3).join(' '));
}

const largerThanTwoChunks = 'x'.repeat(2 * mostContentChunkBytes + 1);

const keptBytes = new TextEncoder().encode('kept');

const chunkShapes: ReadonlyArray<readonly [string, unknown]> = [
  ['a Uint8Array', keptBytes],
  ['an ArrayBuffer', keptBytes.slice().buffer],
];

function headOf(uploadId: string) {
  return { upload_id: uploadId, bytes: 4, chunks: 1, media_type: 'text/plain' };
}

describe('the writes of a recorded content', () => {
  it('write its chunks first, each on its own, its head last, and read back the head they wrote', async () => {
    const recording = recordingFinding([]);

    const put = Effect.runPromise(
      sqliteContentOn(recording.pool).content.put(alpha, textToKeep(largerThanTwoChunks, 'text/plain')),
    );

    await expect(put).rejects.toThrow('No head names the content just put, though nothing deletes what is kept');
    expect(kindsOf(recording)).toEqual([
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_heads',
      'SELECT upload_id, CAST(bytes',
      'DELETE FROM recorded_content_chunks',
    ]);
  });

  it('write nothing for a content of one chunk the playbook holds, nor for one it was told to expect, and answer the head held', async () => {
    const small = recordingFinding([headOf('another')]);
    const expected = recordingFinding([headOf('another')]);

    const kept = await Effect.runPromise(
      Effect.all([
        sqliteContentOn(small.pool).content.put(alpha, textToKeep('kept', 'application/json')),
        sqliteContentOn(expected.pool).content.put(alpha, {
          ...textToKeep(largerThanTwoChunks, 'text/plain'),
          expected: { sha256: sha256Of(largerThanTwoChunks) },
        }),
      ]),
    );

    expect(kept).toEqual([
      { sha256: sha256Of('kept'), bytes: 4, mediaType: 'text/plain' },
      { sha256: sha256Of(largerThanTwoChunks), bytes: 4, mediaType: 'text/plain' },
    ]);
    expect([kindsOf(small), kindsOf(expected)]).toEqual([
      ['SELECT upload_id, CAST(bytes'],
      ['SELECT upload_id, CAST(bytes'],
    ]);
  });
});

describe('the writes of a recorded content that another put of its digest raced', () => {
  it('remove the chunks of a put whose head another put of the digest wrote first, and answer that head', async () => {
    const recording = recordingFinding([headOf('another')]);

    const kept = await Effect.runPromise(
      sqliteContentOn(recording.pool).content.put(alpha, textToKeep(largerThanTwoChunks, 'text/plain')),
    );

    expect(kept).toEqual({ sha256: sha256Of(largerThanTwoChunks), bytes: 4, mediaType: 'text/plain' });
    expect(kindsOf(recording).slice(-3)).toEqual([
      'INSERT INTO recorded_content_heads',
      'SELECT upload_id, CAST(bytes',
      'DELETE FROM recorded_content_chunks',
    ]);
    expect(recording.statements.at(-1)).toMatch(
      /^DELETE FROM recorded_content_chunks WHERE playbook_key = "playbook\/acme\/alpha\/" AND upload_id = "[0-9a-f-]{36}" AND NOT EXISTS \(SELECT 1 FROM recorded_content_heads WHERE playbook_key = "playbook\/acme\/alpha\/" AND upload_id = "[0-9a-f-]{36}" AND sha256 = "[0-9a-f]{64}"\)$/u,
    );
  });
});

describe('the reads and the removals of a recorded content', () => {
  it('read no chunk of a digest the playbook does not hold', async () => {
    const recording = recordingFinding([]);

    const read = await Effect.runPromise(sqliteContentOn(recording.pool).content.get(alpha, 'digest'));

    expect([read, kindsOf(recording)]).toEqual([undefined, ['SELECT upload_id, CAST(bytes']]);
  });

  it.each(chunkShapes)('read a content back from a chunk its store answers as %s', async (_shape, chunk) => {
    const recording = recordingHoldingOneChunk(chunk);

    const read = await Effect.runPromise(
      Effect.flatMap(
        Effect.flatMap(sqliteContentOn(recording.pool).content.get(alpha, sha256Of('kept')), Effect.fromNullishOr),
        textOfContent,
      ),
    );

    expect(read).toBe('kept');
  });
});
