import { erasingReader, keptIn } from '@on.auto/definitions/testing';
import { Unavailable, type Context, type RecordedEvent } from '@on.auto/operations';
import { payloadReaderOf, type PayloadReader } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { followedEventOf, followedEventRead, type FollowedEvent } from './followed-events.ts';

const at = '2026-10-01T09:00:00.000Z';

const alpha = { org: 'acme', playbook: 'alpha' };

const ofTheReport: Context = {
  at,
  by: 'acme-admin',
  runId: 'r-1',
  definitionType: 'workflow',
  definitionName: 'report',
  definitionVersion: 1,
};

const output = { report: 'r'.repeat(40_000) };

function recordOf(stream: string, type: string, data: Schema.Json, context: Context): RecordedEvent {
  return {
    id: `id-${stream}`,
    cursor: 'c',
    causationId: null,
    correlationId: null,
    stream,
    version: 2,
    globalPosition: 2,
    type,
    data,
    context,
    recordedAt: at,
  };
}

function followedOf(record: RecordedEvent): FollowedEvent {
  const followed = followedEventOf(record, 'workflow');
  if (typeof followed === 'string') {
    throw new TypeError(`The record ${record.id} makes no event`);
  }
  return followed;
}

async function keptSuccess() {
  const { content } = memoryLedger().service;
  const { sha256, bytes } = await Effect.runPromise(keptIn(content, alpha, output));
  const record = recordOf(
    'runs/r-1',
    'run_succeeded',
    { output_sha256: sha256, output_bytes: bytes, record: {} },
    ofTheReport,
  );
  return { record, followed: followedOf(record), reader: payloadReaderOf({ owner: alpha, content }) };
}

function unanswering(reader: PayloadReader): PayloadReader {
  return { ...reader, json: () => Effect.fail(new Unavailable({ detail: 'The content store did not answer' })) };
}

describe('the event of a run’s success whose output its playbook keeps outside, read for its consumers', () => {
  it('carries the output read from the playbook’s content', async () => {
    const { record, followed, reader } = await keptSuccess();

    const read = await Effect.runPromise(followedEventRead(record, followed, reader));

    expect(followed.event.data).toEqual({ output_bytes: JSON.stringify(output).length });
    expect(read).toEqual({ event: { ...followed, event: { ...followed.event, data: { output } } } });
  });

  it('is held while the content store does not answer, missing where it holds the output no more, and its size where erased', async () => {
    const { record, followed, reader } = await keptSuccess();
    const reads = [
      followedEventRead(record, followed, unanswering(reader)),
      followedEventRead(record, followed, payloadReaderOf({ owner: alpha, content: memoryLedger().service.content })),
      followedEventRead(record, followed, erasingReader(alpha)),
    ];

    expect(await Effect.runPromise(Effect.all(reads))).toEqual(['held', 'missing', { event: followed }]);
  });

  it('is as it was made, reading nothing, for a published event', async () => {
    const told = { specversion: '1.0', id: 'e1', source: '/acme', type: 'com.acme.told', time: at };
    const record = recordOf('events/e1', 'event_published', { event: told, filled: [] }, { at, by: 'acme-admin' });
    const followed = followedOf(record);

    expect(await Effect.runPromise(followedEventRead(record, followed, erasingReader(alpha)))).toEqual({
      event: followed,
    });
  });
});
