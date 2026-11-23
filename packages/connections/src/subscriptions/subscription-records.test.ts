import type { Ledger } from '@on.auto/operations';
import type { RecordedFailure, SubscriptionKey } from '@on.auto/providers';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { keptLedger } from '../testing/kept-ledger.ts';
import {
  EventSubscriptionEventSchema,
  eventSubscriptionStreamOf,
  type RecordedEventSubscriptionEvent,
} from './subscription-facts.ts';
import { recordedSubscriptionAt, subscriptionRecordsOf, subscriptionsInAPage } from './subscription-records.ts';
import { eventSubscriptions } from './subscription-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const chat: SubscriptionKey = { connection: 'chat', topic: 'C0123' };

const repository: SubscriptionKey = { connection: 'tracker', topic: 'acme/site' };

const declared = 'a'.repeat(64);

const redeclared = 'b'.repeat(64);

const nine = Date.parse('2026-11-18T09:00:00.000Z');

const minute = 60_000;

const madeThroughAWebhook = { type: 'webhook', id: 'subscription-1', secretId: 'secret-1', declared } as const;

const madeIntoAQueue = { type: 'queue', id: 'subscription-1', declared } as const;

const passing: RecordedFailure = { kind: 'unreachable', because: 'rate_limited', attempted: { declared } };

const refused: RecordedFailure = { kind: 'not_sent', because: 'not_sent' };

const lacking: RecordedFailure = {
  kind: 'scope_lacking',
  because: 'scope_lacking',
  attempted: { connected: '2026-11-17T08:00:00.000Z', declared },
};

function recordsOver() {
  const ledger = keptLedger(eventSubscriptions).service;
  return { ledger, records: subscriptionRecordsOf(ledger) };
}

function at<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(TestClock.setTime(nine).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())));
}

const noTypes: readonly string[] = [];

const typesFold = {
  initialState: noTypes,
  evolve: (types: readonly string[], { type }: RecordedEventSubscriptionEvent): readonly string[] => [...types, type],
  eventSchema: EventSubscriptionEventSchema,
};

async function recordedTypes(ledger: Ledger['Service'], key: SubscriptionKey): Promise<readonly string[]> {
  const { state } = await Effect.runPromise(ledger.load(eventSubscriptionStreamOf(alpha, key), typesFold));
  return state;
}

describe('a subscription the record holds', () => {
  it('is held as made, with no positions until the loop moves them, and only in its own playbook', async () => {
    const { records } = recordsOver();
    await at(records.made(alpha, chat, madeThroughAWebhook));

    expect(await at(records.read(alpha))).toEqual([{ ...chat, made: madeThroughAWebhook }]);
    expect(await at(records.read(beta))).toEqual([]);
  });

  it('has its positions moved in place, all three at once, absent ones as none', async () => {
    const { records } = recordsOver();
    const positions = { failures: 0, lapsesAt: nine + 10 * minute, dueAt: nine + 5 * minute };
    await at(records.made(alpha, chat, madeThroughAWebhook));
    await at(records.moved(alpha, chat, positions));

    expect(await at(records.read(alpha))).toEqual([{ ...chat, made: madeThroughAWebhook, positions }]);

    await at(records.moved(alpha, chat, { failures: 0 }));

    expect(await at(records.read(alpha))).toEqual([{ ...chat, made: madeThroughAWebhook, positions: { failures: 0 } }]);
  });

  it('moves no positions of a key it does not hold', async () => {
    const { records } = recordsOver();
    await at(records.moved(alpha, repository, { failures: 1 }));

    expect(await at(records.read(alpha))).toEqual([]);
  });

  it('is read whole, page after page', async () => {
    const { records } = recordsOver();
    const topics = Array.from({ length: subscriptionsInAPage + 3 }, (_, index) => `topic-${index}`);
    await at(
      Effect.forEach(topics, (topic) => records.made(alpha, { connection: 'chat', topic }, madeThroughAWebhook)),
    );

    expect((await at(records.read(alpha))).map(({ topic }) => topic).toSorted()).toEqual(topics.toSorted());
  });
});

describe('a failure the record holds', () => {
  it('is kept beside what was made and its positions', async () => {
    const { records } = recordsOver();
    await at(records.made(alpha, chat, madeIntoAQueue));
    await at(records.moved(alpha, chat, { failures: 1, dueAt: nine + minute }));
    await at(records.failed(alpha, chat, passing));

    expect(await at(records.read(alpha))).toEqual([
      { ...chat, made: madeIntoAQueue, failed: passing, positions: { failures: 1, dueAt: nine + minute } },
    ]);
  });

  it('is cleared by a later subscription made, which keeps the positions', async () => {
    const { records } = recordsOver();
    await at(records.made(alpha, chat, madeIntoAQueue));
    await at(records.moved(alpha, chat, { failures: 1, dueAt: nine + minute }));
    await at(records.failed(alpha, chat, passing));
    await at(records.made(alpha, chat, { ...madeThroughAWebhook, declared: redeclared }));

    expect(await at(records.read(alpha))).toEqual([
      {
        ...chat,
        made: { ...madeThroughAWebhook, declared: redeclared },
        positions: { failures: 1, dueAt: nine + minute },
      },
    ]);
  });

  it('starts a row of its own for a key never made, with or without what the attempt saw', async () => {
    const { records } = recordsOver();
    await at(records.failed(alpha, chat, refused));
    await at(records.failed(alpha, repository, lacking));

    expect(await at(records.read(alpha))).toEqual(
      expect.arrayContaining([
        { ...chat, failed: refused },
        { ...repository, failed: lacking },
      ]),
    );
  });
});

describe('a subscription the record removes', () => {
  it('leaves nothing held, positions included, and is recorded once', async () => {
    const { ledger, records } = recordsOver();
    await at(records.made(alpha, chat, madeThroughAWebhook));
    await at(records.moved(alpha, chat, { failures: 0, dueAt: nine + minute }));
    await at(records.removed(alpha, chat));
    await at(records.removed(alpha, chat));
    await at(records.moved(alpha, chat, { failures: 3 }));

    expect(await at(records.read(alpha))).toEqual([]);
    expect(await recordedTypes(ledger, chat)).toEqual(['event_subscription_made', 'event_subscription_removed']);
  });

  it('is made afresh by a later subscription of the same key', async () => {
    const { records } = recordsOver();
    await at(records.made(alpha, chat, madeThroughAWebhook));
    await at(records.moved(alpha, chat, { failures: 0, dueAt: nine + minute }));
    await at(records.removed(alpha, chat));
    await at(records.made(alpha, chat, madeThroughAWebhook));

    expect(await at(records.read(alpha))).toEqual([{ ...chat, made: madeThroughAWebhook }]);
  });
});

describe('what the record can hold', () => {
  it('is a key or an id as the delivery holds a part: some text, 256 bytes at most, no forbidden character', () => {
    const { holds } = recordsOver().records;
    const parts = ['C0123', 'é'.repeat(128), '', 'é'.repeat(129), 'C\u0000'];

    expect(parts.map((part) => holds(part))).toEqual([true, true, false, false, false]);
  });
});

describe('one subscription read by its key', () => {
  it('is the row of that key, made or removed, and none where no row of the playbook holds the key', async () => {
    const { ledger, records } = recordsOver();
    await at(records.made(alpha, chat, madeThroughAWebhook));
    await at(records.made(alpha, repository, madeThroughAWebhook));
    await at(records.removed(alpha, repository));

    const read = await at(
      Effect.all([
        recordedSubscriptionAt(ledger, alpha, chat),
        recordedSubscriptionAt(ledger, alpha, repository),
        recordedSubscriptionAt(ledger, beta, chat),
      ]),
    );

    expect(read).toEqual([{ ...chat, made: madeThroughAWebhook }, repository, undefined]);
  });
});
