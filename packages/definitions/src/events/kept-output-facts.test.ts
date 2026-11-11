import { memoryRecordedContent } from '@on.auto/content/testing';
import type { Context, RecordedEvent } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { payloadsKeptIn } from '../payloads/run-payloads.ts';
import { erasingReader, keptArmOf, keptIn } from '../testing/kept-payloads.ts';
import { testRunId as runId } from '../testing/run-facts.ts';
import { mostPublishedEventBytes } from './cloud-event.ts';
import {
  playbookEventBytesToRead,
  playbookEventOf,
  playbookEventRead,
  playbookFactOf,
  playbookFactRead,
} from './playbook-facts.ts';

const at = '2026-10-01T09:00:05.000Z';

const alpha = { org: 'acme', playbook: 'alpha' };

const ofSummary: Context = {
  at,
  by: 'acme-admin',
  runId,
  definitionType: 'reasoning',
  definitionName: 'summary',
  definitionVersion: 3,
};

function jsonBytesOf(value: Schema.Json): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function ofRun(event: Pick<RecordedEvent, 'type' | 'data'>): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    causationId: null,
    correlationId: null,
    version: 1,
    globalPosition: 1,
    recordedAt: at,
    stream: `runs/${runId}`,
    type: event.type,
    data: event.data,
    context: ofSummary,
  };
}

const aboutTheRun = {
  specversion: '1.0',
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  source: `/runs/${runId}`,
  type: 'run_succeeded',
  subject: 'reasoning/summary',
  time: at,
  caller: 'acme-admin',
  definitionversion: 3,
};

function keptSuccessOf(output: Schema.Json): RecordedEvent {
  const { sha256, bytes } = keptArmOf(output);
  return ofRun({ type: 'run_succeeded', data: { output_sha256: sha256, output_bytes: bytes, record: {} } });
}

const report = { summary: 'x'.repeat(4096) };

const room = mostPublishedEventBytes - jsonBytesOf({ ...aboutTheRun, data: { output: '' } });

async function contentKeeping(...outputs: readonly Schema.Json[]) {
  const content = memoryRecordedContent();
  await Effect.runPromise(Effect.forEach(outputs, (output) => keptIn(content, alpha, output)));
  return payloadsKeptIn(content, alpha);
}

describe('the event of a success whose output its playbook keeps outside the run', () => {
  it('is its size, as an output too large for an event is, where it is made with no read', () => {
    expect(playbookFactOf(keptSuccessOf(report))).toEqual({
      ...aboutTheRun,
      data: { output_bytes: jsonBytesOf(report) },
    });
  });

  it('carries the output read from the content of its playbook where the event holds it', async () => {
    const payloads = await contentKeeping(report);

    expect(await Effect.runPromise(playbookFactRead(keptSuccessOf(report), payloads))).toEqual({
      ...aboutTheRun,
      data: { output: report },
    });
  });

  it('is its size, read from its record alone, one byte past the bound of an event, and the output at the bound', async () => {
    const fitting = 'x'.repeat(room);
    const payloads = await contentKeeping(fitting);
    const past = `${fitting}x`;

    expect(await Effect.runPromise(playbookFactRead(keptSuccessOf(fitting), payloads))).toHaveProperty(
      'data.output',
      fitting,
    );
    expect(await Effect.runPromise(playbookFactRead(keptSuccessOf(past), payloads))).toHaveProperty(
      'data.output_bytes',
      room + 3,
    );
  });

  it('fails as its read fails, missing or erased, so the follower decides what each means', async () => {
    const reads = [
      playbookFactRead(keptSuccessOf(report), await contentKeeping()),
      playbookFactRead(keptSuccessOf(report), erasingReader(alpha)),
    ];

    expect(await Effect.runPromise(Effect.all(reads.map((read) => Effect.flip(read))))).toMatchObject([
      { _tag: 'payload_missing' },
      { _tag: 'payload_erased' },
    ]);
  });
});

describe('the bytes the event of a success reads from its playbook’s content', () => {
  it('names the bytes its read loads, none where the output would not fit the event', () => {
    const fitting = 'x'.repeat(room);

    expect([
      playbookEventBytesToRead(keptSuccessOf(report)),
      playbookEventBytesToRead(keptSuccessOf(fitting)),
      playbookEventBytesToRead(keptSuccessOf(`${fitting}x`)),
    ]).toEqual([jsonBytesOf(report), room + 2, 0]);
  });
});

describe('the event of every other fact, read with the payloads it may keep', () => {
  it('is made as before for every other fact, reading nothing, published events among them', async () => {
    const payloads = erasingReader(alpha);
    const inline = ofRun({ type: 'run_succeeded', data: { output: 'short', record: {} } });
    const rejected = ofRun({ type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } });
    const published = {
      ...ofRun({ type: 'run_failed', data: {} }),
      stream: 'events/0b1c2d3e',
      type: 'event_published',
      data: {
        event: { specversion: '1.0', id: 'e-1', source: '/outside', type: 'order.placed', time: at },
        filled: [],
      },
      context: { at, by: 'acme-admin' },
    };
    const unknown = { ...inline, stream: 'notes/a' };
    const retired = {
      ...inline,
      stream: 'definitions/workflow',
      type: 'definition_retired',
      data: {},
      context: { at, by: 'acme-admin', definitionType: 'workflow', definitionName: 'follow-up', definitionVersion: 2 },
    };

    expect(
      await Effect.runPromise(
        Effect.all([
          playbookFactRead(inline, payloads),
          playbookFactRead(rejected, payloads),
          playbookEventRead(published, payloads),
          playbookEventRead(unknown, payloads),
          playbookFactRead(retired, payloads),
        ]),
      ),
    ).toEqual([
      playbookFactOf(inline),
      playbookFactOf(rejected),
      playbookEventOf(published),
      undefined,
      playbookFactOf(retired),
    ]);
    expect([
      playbookEventBytesToRead(inline),
      playbookEventBytesToRead(rejected),
      playbookEventBytesToRead(published),
      playbookEventBytesToRead(unknown),
      playbookEventBytesToRead(retired),
    ]).toEqual([0, 0, 0, 0, 0]);
  });
});
