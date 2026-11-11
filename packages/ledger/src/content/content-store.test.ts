import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { mostContentChunkBytes, sha256Of, textOfContent, textToKeep } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inTransactionOf, type ReturningExecutor, type TransactionalPool } from '../event-store.ts';
import { sqliteContentOn } from './content-store.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Recording {
  readonly pool: TransactionalPool<ReturningExecutor>;
  readonly statements: readonly string[];
}

function recordingAnswering(rowsOf: (statement: string) => readonly unknown[]): Recording {
  const statements: string[] = [];
  const answered = (sql: SQL) => {
    const statement = described(sql);
    statements.push(statement);
    return Promise.resolve({ rows: rowsOf(statement) });
  };
  const execute: ReturningExecutor = { query: answered, command: answered };
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

function answeringTheRemovedUpload(statement: string): readonly unknown[] {
  return statement.startsWith('DELETE FROM recorded_content_heads') ? [{ upload_id: 'u1' }] : [];
}

function answeringAHeadThatStands(statement: string): readonly unknown[] {
  return statement.startsWith('SELECT 1 AS standing') ? [{ standing: 1 }] : [];
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
  it('write its chunks first, each on its own, its head last, read back the head they wrote, and answer what the put took where a removal took the head first', async () => {
    const recording = recordingFinding([]);

    const kept = await Effect.runPromise(
      sqliteContentOn(recording.pool).content.put(alpha, textToKeep(largerThanTwoChunks, 'text/plain')),
    );

    expect(kept).toEqual({
      sha256: sha256Of(largerThanTwoChunks),
      bytes: 2 * mostContentChunkBytes + 1,
      mediaType: 'text/plain',
    });
    expect(kindsOf(recording)).toEqual([
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_heads',
      'SELECT upload_id, CAST(bytes',
      'DELETE FROM recorded_content_chunks',
    ]);
  });

  it('write nothing for a content of one chunk the playbook holds, nor for one it was told to expect, but the time the head held was kept, and answer that head', async () => {
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
      ['UPDATE recorded_content_heads SET'],
      ['UPDATE recorded_content_heads SET'],
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

describe('the removals of a recorded content', () => {
  it("remove a content kept before a time within the transaction they are given, its head first, answering its upload, and that upload's chunks after, and look for a head that stands where none was removed", async () => {
    const [held, standing, none] = [
      recordingAnswering(answeringTheRemovedUpload),
      recordingAnswering(answeringAHeadThatStands),
      recordingFinding([]),
    ];

    const removed = await Promise.all(
      [held, standing, none].map(({ pool }) =>
        inTransactionOf(pool)(sqliteContentOn(pool).removalWithin(alpha, 'digest', 1000)),
      ),
    );

    const headRemoved =
      'DELETE FROM recorded_content_heads WHERE playbook_key = "playbook/acme/alpha/" AND sha256 = "digest" AND kept_at < 1000 RETURNING upload_id';
    const headSought =
      'SELECT 1 AS standing FROM recorded_content_heads WHERE playbook_key = "playbook/acme/alpha/" AND sha256 = "digest"';
    expect(removed).toEqual(['removed', 'fresh', 'removed']);
    expect([held.statements, standing.statements, none.statements]).toEqual([
      [
        'BEGIN',
        headRemoved,
        'DELETE FROM recorded_content_chunks WHERE playbook_key = "playbook/acme/alpha/" AND upload_id = "u1"',
        'COMMIT',
      ],
      ['BEGIN', headRemoved, headSought, 'COMMIT'],
      ['BEGIN', headRemoved, headSought, 'COMMIT'],
    ]);
  });
});

describe('the reads of a recorded content', () => {
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
