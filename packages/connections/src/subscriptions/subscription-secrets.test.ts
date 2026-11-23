import { Effect, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { keptSecrets } from '../testing/harness-services.ts';
import { keptLedger } from '../testing/kept-ledger.ts';
import { deliverySecretsOf } from './subscription-deliveries.ts';
import {
  EventSubscriptionEventSchema,
  eventSubscriptionStreamOf,
  type RecordedEventSubscriptionEvent,
} from './subscription-facts.ts';
import { subscriptionRecordsOf } from './subscription-records.ts';
import { eventSubscriptions } from './subscription-rows.ts';
import { subscriptionSecretsOf } from './subscription-secrets.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const chat = { connection: 'chat', topic: 'C0123' };

const place = { ...alpha, connection: 'chat' };

const noFacts: readonly RecordedEventSubscriptionEvent[] = [];

const factsFold = {
  initialState: noFacts,
  evolve: (facts: readonly RecordedEventSubscriptionEvent[], fact: RecordedEventSubscriptionEvent) => [...facts, fact],
  eventSchema: EventSubscriptionEventSchema,
};

function valueOf(secret: Redacted.Redacted | undefined): string | undefined {
  return secret === undefined ? undefined : Redacted.value(secret);
}

async function madeAndRecorded() {
  const secrets = subscriptionSecretsOf(keptSecrets({}));
  const ledger = keptLedger(eventSubscriptions).service;
  const made = await Effect.runPromise(secrets.make(place));
  const madeSubscription = {
    type: 'webhook',
    id: 'subscription-1',
    secretId: made.id,
    declared: 'a'.repeat(64),
  } as const;
  await Effect.runPromise(
    subscriptionRecordsOf(ledger).made(alpha, chat, madeSubscription).pipe(Effect.provide(TestClock.layer())),
  );
  const { state } = await Effect.runPromise(ledger.load(eventSubscriptionStreamOf(alpha, chat), factsFold));
  return { secrets, made, facts: state };
}

describe('the secret of a subscription', () => {
  it('is made as the Standard Webhooks specification writes one and kept in the secret store', async () => {
    const { secrets, made } = await madeAndRecorded();

    expect(Redacted.value(made.secret)).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/u);
    expect(valueOf(await Effect.runPromise(secrets.read(place, made.id)))).toBe(Redacted.value(made.secret));
  });

  it('is recorded by its id alone, never in a fact', async () => {
    const { made, facts } = await madeAndRecorded();

    expect(facts.map(({ data }) => data)).toEqual([expect.objectContaining({ secret_id: made.id })]);
    expect(JSON.stringify(facts)).not.toContain(Redacted.value(made.secret));
  });

  it('is kept as a service answered it, and read as none once forgotten', async () => {
    const secrets = subscriptionSecretsOf(keptSecrets({}));
    const kept = await Effect.runPromise(secrets.keep(place, Redacted.make('whsec_answered-by-the-service')));

    expect(valueOf(await Effect.runPromise(secrets.read(place, kept)))).toBe('whsec_answered-by-the-service');

    await Effect.runPromise(secrets.forget(place, kept));

    expect(await Effect.runPromise(secrets.read(place, kept))).toBeUndefined();
  });
});

type MadeType = 'webhook' | 'queue';

function heldBy() {
  const kept = keptSecrets({});
  const ledger = keptLedger(eventSubscriptions).service;
  const records = subscriptionRecordsOf(ledger);
  const made = async (playbook: string, topic: string, secret?: string, type: MadeType = 'webhook') => {
    const secretId =
      secret === undefined ? undefined : await Effect.runPromise(Effect.orDie(kept.keep(Redacted.make(secret))));
    const declaredBy = { type, id: `hook-of-${topic}`, declared: 'a'.repeat(64) };
    const key = { connection: topic.startsWith('room') ? 'rooms' : 'chat', topic };
    await Effect.runPromise(
      records.made({ org: 'acme', playbook }, key, secretId === undefined ? declaredBy : { ...declaredBy, secretId }),
    );
  };
  const secretsOf = deliverySecretsOf({ ledger, secrets: kept });
  const read = async (playbook: string, connection: string, provenBy: 'subscription' | 'app' = 'subscription') =>
    (await Effect.runPromise(secretsOf({ org: 'acme', playbook, connection }, provenBy)))
      .map(({ subscription: { topic, id }, secret }) => `${topic} ${id} ${String(valueOf(secret))}`)
      .toSorted((one, other) => one.localeCompare(other));
  return { kept, records, made, read };
}

describe('the secrets a delivery to a connection’s events address is proven with', () => {
  it('are those of the webhook subscriptions the playbook holds through that connection, each with its own topic and id, and no other playbook’s or connection’s', async () => {
    const { made, read } = heldBy();
    await made('alpha', 'C0123', 'whsec_alpha-C0123');
    await made('alpha', 'C0456', 'whsec_alpha-C0456');
    await made('alpha', 'C0789', 'whsec_alpha-queue', 'queue');
    await made('beta', 'C0123', 'whsec_beta-C0123');
    await made('alpha', 'room-5', 'whsec_alpha-room-5');

    expect([await read('alpha', 'chat'), await read('beta', 'chat'), await read('alpha', 'notes')]).toEqual([
      ['C0123 hook-of-C0123 whsec_alpha-C0123', 'C0456 hook-of-C0456 whsec_alpha-C0456'],
      ['C0123 hook-of-C0123 whsec_beta-C0123'],
      [],
    ]);
  });

  it('are none once the subscription is removed, failed only, holding no secret or one the store no longer has, and none of the app here', async () => {
    const { kept, records, made, read } = heldBy();
    await made('alpha', 'C0123', 'whsec_alpha-C0123');
    await made('alpha', 'C0456');
    await made('beta', 'C0123', 'whsec_beta-C0123');
    await Effect.runPromise(records.removed(alpha, chat));
    await Effect.runPromise(
      records.failed(alpha, { connection: 'chat', topic: 'C0999' }, { kind: 'not_sent', because: 'not_sent' }),
    );
    await Effect.runPromise(kept.forget('secret-2'));

    expect([await read('alpha', 'chat'), await read('beta', 'chat'), await read('alpha', 'chat', 'app')]).toEqual([
      [],
      [],
      [],
    ]);
  });
});
