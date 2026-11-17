import { presentationOf, type Context, type RecordedEvent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { publishedEventStreamOf, type EventPublished } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';

function wordsNaming(text: string): unknown {
  return expect.stringContaining(text);
}

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
        summary: wordsNaming('“com.acme.ledger.opened”'),
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
        summary: wordsNaming('“close”'),
        data: { subject: 'september', data: { region: 'eu' } },
        metadata: { run_id: 'r-1', depth: 1, definition: { type: 'workflow', name: 'close', version: 2 } },
      },
      { data: { data_bytes: 3002 } },
    ]);
  });
});

const reason =
  'An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach';

describe('the presenter of the refused reactions of a workflow', () => {
  it('says in words that the workflow of its context was not started every time its triggers called for it, and gives the count and the last reason, with its kind, because and trigger where it has them', () => {
    const context = {
      at: '2026-10-01T09:01:00.000Z',
      by: 'playbook:alpha',
      definitionType: 'workflow',
      definitionName: 'close-the-month',
      definitionVersion: 2,
    };
    const data = { count: 3, reason, minute: '2026-10-01T09:00:00.000Z' };

    const coded = {
      ...data,
      kind: 'credits_exhausted',
      because: 'free_daily_limit',
      trigger: { kind: 'every', reference: '/schedule/every' },
    };

    expect(present(recordOf('reactions/close-the-month', 'reaction_refused', data, context), showing)).toMatchObject([
      {
        type: 'reaction_refused',
        summary: wordsNaming('“close-the-month”'),
        data,
        metadata: { definition: { type: 'workflow', name: 'close-the-month', version: 2 } },
      },
    ]);
    expect(present(recordOf('reactions/close-the-month', 'reaction_refused', coded, context), showing)).toMatchObject([
      { type: 'reaction_refused', data: coded },
    ]);
  });
});
