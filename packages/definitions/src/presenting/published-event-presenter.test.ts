import { presentationOf, type Context, type RecordedEvent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { publishedEventStreamOf, type EventPublished } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

function recordOf(stream: string, type: string, data: unknown, context: Context): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

const event = {
  specversion: '1.0' as const,
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  source: 'https://acme.example/ledger',
  type: 'com.acme.ledger.opened',
  time: '2026-10-01T09:00:01.000Z',
};

function presented(published: EventPublished, context: Context) {
  const stream = publishedEventStreamOf(published.data.event.source, published.data.event.id);
  return present(recordOf(stream, published.type, published.data, context), showing);
}

const publishedBy: Context = { at: '2026-10-01T09:00:01.000Z', by: 'acme-admin' };

describe('the presenter of a published event', () => {
  it('shows its id, type, source and time, and leaves out a subject and data it does not have', () => {
    expect(presented({ type: 'event_published', data: { event, filled: ['id', 'time'] } }, publishedBy)).toMatchObject([
      {
        type: 'event_published',
        summary: 'The event “com.acme.ledger.opened” was published to the playbook.',
        data: {
          event_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          event_type: 'com.acme.ledger.opened',
          source: 'https://acme.example/ledger',
          time: '2026-10-01T09:00:01.000Z',
          filled: ['id', 'time'],
        },
        metadata: { by: 'acme-admin' },
      },
    ]);
  });

  it('shows its subject and its data within 2 KiB, its data past it as its size, and the workflow that emitted it', () => {
    const emitted: Context = {
      ...publishedBy,
      runId: 'r-1',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 2,
      depth: 1,
    };
    const withData = { ...event, subject: 'september', data: { region: 'eu' } };

    expect([
      ...presented({ type: 'event_published', data: { event: withData, filled: [] } }, emitted),
      ...presented(
        { type: 'event_published', data: { event: { ...event, data: 'x'.repeat(3000) }, filled: [] } },
        publishedBy,
      ),
    ]).toMatchObject([
      {
        summary: 'The workflow “close” emitted the event “com.acme.ledger.opened”.',
        data: { subject: 'september', data: { region: 'eu' } },
        metadata: { run_id: 'r-1', depth: 1, definition: { type: 'workflow', name: 'close', version: 2 } },
      },
      { data: { data_bytes: 3002 } },
    ]);
  });
});
