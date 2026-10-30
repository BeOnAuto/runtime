import { sha256Of, textOfContent, textToKeep } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { postgresqlContentOn, type ContentConnection, type ContentConnections } from './postgresql-content.ts';

interface Asked {
  readonly on: string;
  readonly text: string;
  readonly values: readonly unknown[];
}

const alpha = { org: 'acme', playbook: 'alpha' };

function connectionsAnswering(
  answerOf: (text: string) => readonly unknown[],
  failing = '',
): { readonly connections: ContentConnections; readonly asked: readonly Asked[] } {
  const asked: Asked[] = [];
  const querying = (on: string) => (text: string, values: readonly unknown[]) => {
    asked.push({ on, text, values });
    return text.startsWith(failing) && failing !== ''
      ? Promise.reject(new Error('The connection dropped'))
      : Promise.resolve({ rows: answerOf(text) });
  };
  const connection: ContentConnection = {
    query: querying('connection'),
    release: () => {
      asked.push({ on: 'connection', text: 'released', values: [] });
    },
  };
  return {
    asked,
    connections: { query: querying('pool'), connect: () => Promise.resolve(connection) },
  };
}

function nothing(): readonly unknown[] {
  return [];
}

function headOf(uploadId: string) {
  return { upload_id: uploadId, bytes: 7, chunks: 1, media_type: 'application/json' };
}

function answeringHeadsAfterTheFirst(): (text: string) => readonly unknown[] {
  let headsAsked = 0;
  return (text) => {
    headsAsked += text.startsWith('SELECT upload_id') ? 1 : 0;
    return headsAsked > 1 ? [headOf('u0')] : [];
  };
}

function answeringOneChunk(text: string): readonly unknown[] {
  return text.startsWith('SELECT upload_id') ? [headOf('u1')] : [{ data: Buffer.from('{"a":1}') }];
}

describe('the content a playbook keeps on PostgreSQL', () => {
  it('binds each chunk as the hex of its bytes', async () => {
    const { connections, asked } = connectionsAnswering(answeringHeadsAfterTheFirst());

    const kept = await Effect.runPromise(
      postgresqlContentOn(connections).content.put(alpha, textToKeep('{"b":2}', 'application/json')),
    );

    expect(kept).toEqual({ sha256: sha256Of('{"b":2}'), bytes: 7, mediaType: 'application/json' });
    expect(asked[1]?.text).toContain("decode($4, 'hex')");
    expect(asked[1]?.values[3]).toBe(Buffer.from('{"b":2}').toString('hex'));
  });

  it('reads the chunks of a head in their order', async () => {
    const { connections } = connectionsAnswering(answeringOneChunk);

    const read = await Effect.runPromise(
      Effect.flatMap(
        Effect.flatMap(postgresqlContentOn(connections).content.get(alpha, sha256Of('{"a":1}')), Effect.fromNullishOr),
        textOfContent,
      ),
    );

    expect(read).toBe('{"a":1}');
  });
});

describe('the content a run staged on PostgreSQL', () => {
  it('is removed in one transaction on one connection, which it releases', async () => {
    const { connections, asked } = connectionsAnswering(nothing);

    await Effect.runPromise(postgresqlContentOn(connections).content.unstage(alpha, 'run-1'));

    expect(asked.map(({ on, text }) => `${on}: ${text.split(' ').slice(0, 3).join(' ')}`)).toEqual([
      'pool: INSERT INTO unstaged_runs',
      'connection: BEGIN',
      'connection: DELETE FROM staged_content',
      'connection: DELETE FROM staged_content_chunks',
      'connection: COMMIT',
      'connection: released',
    ]);
  });

  it('rolls the transaction back when a delete fails, releases its connection, and fails as a defect', async () => {
    const { connections, asked } = connectionsAnswering(nothing, 'DELETE FROM staged_content_chunks');

    const unstaged = Effect.runPromise(postgresqlContentOn(connections).content.unstage(alpha, 'run-1'));

    await expect(unstaged).rejects.toThrow('The connection dropped');
    expect(asked.slice(-3).map(({ text }) => text.split(' ').slice(0, 3).join(' '))).toEqual([
      'DELETE FROM staged_content_chunks',
      'ROLLBACK',
      'released',
    ]);
  });
});
