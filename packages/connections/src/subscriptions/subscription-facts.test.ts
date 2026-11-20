import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { presentationOf, presentedChangeCatalogOf, type RecordedEvent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventSubscriptionEventSchema,
  eventSubscriptionStreamOf,
  type RecordedEventSubscriptionEvent,
} from './subscription-facts.ts';
import { subscriptionLayoutSteps } from './subscription-layout.ts';
import { eventSubscriptionPresenter } from './subscription-presenter.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const chat = { connection: 'chat', topic: 'C0123' };

const declared = 'a'.repeat(64);

const acted = { at: '2026-11-18T09:00:00.000Z', by: 'runtime' };

const baseline: readonly RecordedEventSubscriptionEvent[] = [
  {
    type: 'event_subscription_made',
    data: { ...chat, type: 'webhook', id: 'subscription-1', secret_id: 'secret-1', declared },
    context: acted,
  },
  {
    type: 'event_subscription_failed',
    data: {
      ...chat,
      kind: 'scope_lacking',
      because: 'scope_lacking',
      attempted: { connected: '2026-11-17T08:00:00.000Z', declared },
    },
    context: acted,
  },
  { type: 'event_subscription_removed', data: chat, context: acted },
];

const decoded = Schema.decodeUnknownResult(EventSubscriptionEventSchema);

function madeWith(data: object): boolean {
  return Result.isSuccess(
    decoded({
      type: 'event_subscription_made',
      data: { ...chat, type: 'webhook', id: 'subscription-1', declared, ...data },
      context: acted,
    }),
  );
}

const read: readonly object[] = [{}, { secret_id: 'secret-1' }, { type: 'queue' }];

const refused: readonly object[] = [
  { topic: '' },
  { topic: 't'.repeat(257) },
  { id: 'subscription\u0000' },
  { type: 'websocket' },
  { declared: 'not a digest' },
];

describe('the facts of a subscription', () => {
  recordedFactsBehaviour({
    schema: EventSubscriptionEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.64.0': baseline },
  });

  it('hold the id of the secret a subscription is proven with, a webhook or a queue, and the digest of its declaration', () => {
    expect(read.map((data) => madeWith(data))).toEqual(read.map(() => true));
  });

  it('refuse a key or an id the record cannot hold, a way no call arranges, and a digest that is not one', () => {
    expect(refused.map((data) => madeWith(data))).toEqual(refused.map(() => false));
  });

  it('are kept on one stream for each connection and topic of a playbook, named by a version 5 UUID of the two', () => {
    const stream = eventSubscriptionStreamOf(alpha, chat);

    expect(stream).toMatch(
      /^playbook\/acme\/alpha\/event-subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(eventSubscriptionStreamOf(alpha, { ...chat })).toBe(stream);
    expect(
      [
        eventSubscriptionStreamOf({ org: 'acme', playbook: 'beta' }, chat),
        eventSubscriptionStreamOf(alpha, { connection: 'tracker', topic: 'C0123' }),
        eventSubscriptionStreamOf(alpha, { connection: 'C0123', topic: 'chat' }),
      ].filter((other) => other === stream),
    ).toEqual([]);
  });
});

const ofThePlaybook = 'playbook/acme/alpha/';

const streamOfChat = eventSubscriptionStreamOf(alpha, chat).slice(ofThePlaybook.length);

function recordOf({ type, data, context }: RecordedEventSubscriptionEvent): RecordedEvent {
  return {
    id: '7d1b2c3a-4e5f-5a6b-8c7d-9e0f1a2b3c4d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream: streamOfChat,
    version: 1,
    globalPosition: 12,
    type,
    data,
    context,
    recordedAt: acted.at,
  };
}

const showing = { streamPrefix: ofThePlaybook, content: nothingKept, view: 'page' } as const;

const inWords: unknown = expect.any(String);

const kinds = ['connection_broken', 'scope_lacking', 'tool_error', 'unreachable', 'not_sent'] as const;

describe('the facts of a subscription among the playbook’s events', () => {
  const { present, publicTypes, storedTypesOf } = presentationOf([eventSubscriptionPresenter]);
  const shown = (fact: RecordedEventSubscriptionEvent) =>
    present(recordOf(fact), showing).map(({ type, data, summary }) => ({ type, data, summary }));

  it('are listed by the names they are recorded by, each with its connection and its place, and a failure with its kind and because, nothing else of what was made or tried', () => {
    expect(publicTypes).toEqual(['event_subscription_made', 'event_subscription_failed', 'event_subscription_removed']);
    expect(publicTypes.map((type) => storedTypesOf(type))).toEqual(publicTypes.map((type) => [type]));
    expect(baseline.map((fact) => shown(fact))).toEqual([
      [{ type: 'event_subscription_made', data: chat, summary: inWords }],
      [
        {
          type: 'event_subscription_failed',
          data: { ...chat, kind: 'scope_lacking', because: 'scope_lacking' },
          summary: inWords,
        },
      ],
      [{ type: 'event_subscription_removed', data: chat, summary: inWords }],
    ]);
  });

  it('say a failure of each kind in its own words', () => {
    const failed = (kind: (typeof kinds)[number]): RecordedEventSubscriptionEvent => ({
      type: 'event_subscription_failed',
      data: { ...chat, kind, because: kind },
      context: acted,
    });

    expect(new Set(kinds.map((kind) => shown(failed(kind))[0]?.summary)).size).toBe(kinds.length);
  });

  it('change the event each is, as every event the playbook lists does', () => {
    const catalog = presentedChangeCatalogOf([eventSubscriptionPresenter]);
    const fact = { id: 'fact-1', stream: streamOfChat, context: acted };

    expect(baseline.map(({ type }) => catalog.changesOf({ ...fact, type }))).toEqual(
      baseline.map(() => [{ kind: 'event', event_id: 'fact-1' }]),
    );
  });
});

describe('the layout the table of the subscriptions takes', () => {
  it('is one step that makes nothing, the ledger making the table as it opens', () => {
    expect(subscriptionLayoutSteps.map(({ statements }) => statements)).toEqual([[]]);
  });
});
