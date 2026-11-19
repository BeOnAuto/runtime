import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { keptSecrets } from '../testing/harness-services.ts';
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
  const ledger = memoryLedger(undefined, [eventSubscriptions]).service;
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
