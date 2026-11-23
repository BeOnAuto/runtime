import type { Ledger } from '@on.auto/operations';
import type { RecordedFailure, SubscriptionKey } from '@on.auto/providers';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { keptLedger } from '../testing/kept-ledger.ts';
import {
  EventSubscriptionEventSchema,
  eventSubscriptionReadDecider,
  EventSubscriptionReadSchema,
  eventSubscriptionReadStreamOf,
  eventSubscriptionStreamOf,
  type RecordedEventSubscriptionEvent,
  type RecordedEventSubscriptionRead,
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

const readsFold = {
  initialState: noTypes,
  evolve: (types: readonly string[], { type }: RecordedEventSubscriptionRead): readonly string[] => [...types, type],
  eventSchema: EventSubscriptionReadSchema,
};

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

const checkedSince = '2026-11-18T08:00:00.000Z';

const madeByChecking = { type: 'polling', declared, since: checkedSince } as const;

const reached = { failures: 0, dueAt: nine + minute };

function readStreamsOf(ledger: Ledger['Service']) {
  return Effect.map(
    ledger.readProjectedRows('event_subscriptions', alpha, { where: [], orderBy: [], order: 'asc', limit: 10 }),
    (rows) => rows.map(({ row }) => [row['since'], row['page_token']]),
  );
}

describe('a subscription a check keeps', () => {
  it('is made with the point it reads from, and moves it with its positions and page in one advance', async () => {
    const { ledger, records } = recordsOver();
    const walking = { since: checkedSince, pageToken: '{"page_token":"2"}', positions: reached };
    await at(records.made(alpha, chat, madeByChecking));
    const made = await at(records.read(alpha));
    await at(records.marked(alpha, chat, walking, checkedSince));
    const walked = await at(records.read(alpha));
    await at(
      records.marked(
        alpha,
        chat,
        { since: '2026-11-18T09:00:00.000Z', pageToken: null, positions: reached },
        checkedSince,
      ),
    );

    expect([made, walked]).toEqual([
      [{ ...chat, made: madeByChecking }],
      [{ ...chat, made: madeByChecking, positions: reached, pageToken: '{"page_token":"2"}' }],
    ]);
    expect(await at(readStreamsOf(ledger))).toEqual([['2026-11-18T09:00:00.000Z', null]]);
  });

  it('moves nothing where its mark moved meanwhile, nor for a key it does not hold', async () => {
    const { records } = recordsOver();
    await at(records.made(alpha, chat, madeByChecking));
    await at(
      records.marked(alpha, chat, { since: 'later', pageToken: null, positions: reached }, 'not where it stands'),
    );
    await at(records.marked(alpha, repository, { since: 'later', pageToken: null, positions: reached }, checkedSince));

    expect(await at(records.read(alpha))).toEqual([{ ...chat, made: madeByChecking }]);
  });
});

describe('the reads of a check the record keeps', () => {
  it('records the point it read to once, on a stream of its own, only where the row stands there', async () => {
    const { ledger, records } = recordsOver();
    const later = '2026-11-18T09:00:00.000Z';
    await at(records.made(alpha, chat, madeByChecking));
    await at(records.readThrough(alpha, chat, later));
    await at(records.marked(alpha, chat, { since: later, pageToken: null, positions: reached }, checkedSince));
    await at(records.readThrough(alpha, chat, later));
    await at(records.readThrough(alpha, chat, later));

    expect(await at(records.read(alpha))).toEqual([
      { ...chat, made: { ...madeByChecking, since: later }, positions: reached },
    ]);
    expect(await at(ledger.load(eventSubscriptionReadStreamOf(alpha, chat, later), readsFold))).toMatchObject({
      state: ['event_subscription_read'],
    });
  });

  it('records no read of a key the record removed, and a read recorded after the removal changes nothing', async () => {
    const { ledger, records } = recordsOver();
    await at(records.made(alpha, chat, madeByChecking));
    await at(records.removed(alpha, chat));
    await at(records.readThrough(alpha, chat, checkedSince));
    const command = { key: chat, since: 'later', at: '2026-11-18T09:00:00.000Z' };
    await at(
      Effect.orDie(
        ledger.execute(eventSubscriptionReadStreamOf(alpha, chat, 'later'), eventSubscriptionReadDecider, command),
      ),
    );

    expect(await at(records.read(alpha))).toEqual([]);
  });
});
