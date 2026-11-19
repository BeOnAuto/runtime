import { memoryLedger } from '@on.auto/operations/testing';
import { resyncedAfterMs } from '@on.auto/providers';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { subscriptionRecordsOf } from './subscription-records.ts';
import { eventSubscriptions } from './subscription-rows.ts';
import { holdsASubscription, playbooksDueOf, reconcileDueAfter, reconcileDueSet } from './subscription-schedule.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const chat = { connection: 'chat', topic: 'C0123' };

const repository = { connection: 'tracker', topic: 'acme/site' };

const made = { type: 'webhook', id: 'subscription-1', declared: 'a'.repeat(64) } as const;

const nine = Date.parse('2026-11-18T09:00:00.000Z');

const minute = 60_000;

function recordsOver() {
  const ledger = memoryLedger(undefined, [eventSubscriptions]).service;
  return { ledger, records: subscriptionRecordsOf(ledger) };
}

function at<A>(time: number, effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(TestClock.setTime(time).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())));
}

function run<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(effect);
}

describe('the playbooks whose subscriptions are due to be reconciled', () => {
  it('are due at once after a fact about one of their subscriptions', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(alpha, chat, made));
    await at(nine + minute, records.failed(beta, repository, { kind: 'not_sent', because: 'not_sent' }));

    expect(await run(playbooksDueOf(ledger, nine + minute, 10))).toEqual([alpha, beta]);
    expect(await run(playbooksDueOf(ledger, nine, 10))).toEqual([alpha]);
  });

  it('are due again when their last round answers, on every subscription they hold, once each', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(alpha, chat, made));
    await at(nine, records.made(alpha, repository, made));
    await run(reconcileDueSet(ledger, alpha, nine, nine + 30 * minute));
    await run(reconcileDueSet(ledger, alpha, nine, nine + 30 * minute));

    expect(await run(playbooksDueOf(ledger, nine + minute, 10))).toEqual([]);
    expect(await run(playbooksDueOf(ledger, nine + 30 * minute, 10))).toEqual([alpha]);
    expect(await run(reconcileDueAfter(ledger, nine + minute))).toBe(nine + 30 * minute);
  });

  it('are due again by the resync period at the latest, where their round answered no time or a later one', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(alpha, chat, made));
    await at(nine, records.made(beta, chat, made));
    await run(reconcileDueSet(ledger, alpha, nine));
    await run(reconcileDueSet(ledger, beta, nine, nine + 2 * resyncedAfterMs));

    expect(await run(playbooksDueOf(ledger, nine + resyncedAfterMs - 1, 10))).toEqual([]);
    expect(await run(playbooksDueOf(ledger, nine + resyncedAfterMs, 10))).toEqual([alpha, beta]);
  });

  it('are not due for a subscription removed', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(beta, chat, made));
    await at(nine, records.removed(beta, chat));

    expect(await run(playbooksDueOf(ledger, nine + 2 * resyncedAfterMs, 10))).toEqual([]);
    expect(await run(reconcileDueAfter(ledger, nine - minute))).toBeNull();
  });
});

describe('the read of the playbooks due', () => {
  it('reads each once, so a playbook of many subscriptions due leaves room for the others', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(alpha, chat, made));
    await at(nine, records.made(alpha, repository, made));
    await at(nine, records.made(alpha, { connection: 'tracker', topic: 'acme/docs' }, made));
    await at(nine + minute, records.made(beta, chat, made));

    expect(await run(playbooksDueOf(ledger, nine + minute, 2))).toEqual([alpha, beta]);
  });
});

describe('a playbook that holds a subscription', () => {
  it('is one with a subscription not removed', async () => {
    const { ledger, records } = recordsOver();
    await at(nine, records.made(alpha, chat, made));

    expect([await run(holdsASubscription(ledger, alpha)), await run(holdsASubscription(ledger, beta))]).toEqual([
      true,
      false,
    ]);

    await at(nine, records.removed(alpha, chat));

    expect(await run(holdsASubscription(ledger, alpha))).toBe(false);
  });
});
