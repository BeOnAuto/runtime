import { eventSubscriptions, subscriptionRecordsOf } from '@on.auto/connections';
import type { RecordWork, Work } from '@on.auto/definitions';
import { requestPlaceFacts } from '@on.auto/interaction';
import type { PlaybookAddress } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { resyncedAfterMs, type Reconciled } from '@on.auto/providers';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { subscriptionRoundsOf, type FactFollowed, type SubscriptionRounds } from './subscription-rounds.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const nine = Date.parse('2026-11-18T09:00:00.000Z');

const minute = 60_000;

const acted = { at: '2026-11-18T09:00:00.000Z', by: 'runtime' };

const madeAtTheTracker = { type: 'webhook', id: 'subscription-1', declared: 'a'.repeat(64) } as const;

const site = { connection: 'tracker', topic: 'site' };

function aLedger() {
  return memoryLedger(undefined, [eventSubscriptions]).service;
}

function followedIn(playbook: PlaybookAddress, id: string): FactFollowed {
  return { playbook, record: { id, context: acted } };
}

function followedOfAWorkflow(playbook: PlaybookAddress, id: string): FactFollowed {
  return { playbook, record: { id, context: { ...acted, definitionName: 'approve' } } };
}

function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect);
}

function madeAt(ledger: ReturnType<typeof aLedger>, playbook: PlaybookAddress): Promise<void> {
  return run(
    TestClock.setTime(nine).pipe(
      Effect.andThen(subscriptionRecordsOf(ledger).made(playbook, site, madeAtTheTracker)),
      Effect.provide(TestClock.layer()),
    ),
  );
}

interface Counted extends SubscriptionRounds {
  readonly rounds: readonly PlaybookAddress[];
}

function roundsOver(ledger: ReturnType<typeof aLedger>, answers: Reconciled = {}, arrangesAWay = false): Counted {
  const rounds: PlaybookAddress[] = [];
  const loop = (playbook: PlaybookAddress) =>
    Effect.sync(() => {
      rounds.push(playbook);
      return answers;
    });
  return { rounds, ...subscriptionRoundsOf({ loop, ledger, arrangesAWay }) };
}

async function asked({ consumer }: SubscriptionRounds, followed: FactFollowed): Promise<readonly string[]> {
  const { deliveries } = await run(consumer.batchOf(followed, undefined, 100));
  await run(Effect.forEach(deliveries, ({ deliver }) => deliver));
  await run(Effect.forEach(deliveries, ({ skipped }) => skipped()));
  return deliveries.map(({ key, workflow }) => `${key} ${workflow}`);
}

async function performedAt(rounds: SubscriptionRounds, now: number): Promise<readonly string[]> {
  const items = await run(rounds.dueWork.due(now, 16, true));
  await run(Effect.forEach(items, (item) => item.perform(now)));
  return items.map(({ key, callsOut }) => `${key} ${String(callsOut)}`);
}

function roundsAskingAgainOnce(
  ledger: ReturnType<typeof aLedger>,
  performed: (playbook: PlaybookAddress) => void,
): SubscriptionRounds {
  const asking = { again: true };
  const rounds: SubscriptionRounds = subscriptionRoundsOf({
    loop: (playbook) =>
      Effect.promise(async () => {
        performed(playbook);
        if (asking.again) {
          asking.again = false;
          await asked(rounds, followedIn(playbook, 'fact-again'));
        }
        return {};
      }),
    ledger,
    arrangesAWay: false,
  });
  return rounds;
}

describe('the facts a round of the subscriptions follows', () => {
  it('are the ends of runs, after which a request no longer waits, each owing its playbook one round', async () => {
    const rounds = roundsOver(aLedger());

    expect(rounds.consumer.types).toEqual(['run_succeeded', 'run_rejected', 'run_failed']);
    expect(rounds.consumer.types.filter((type) => !requestPlaceFacts.includes(type))).toEqual([]);
    expect(await asked(rounds, followedOfAWorkflow(alpha, 'fact-1'))).toEqual(['fact-1 approve']);
    expect(await asked(rounds, followedIn(alpha, 'fact-2'))).toEqual(['fact-2 ']);
    expect(await run(rounds.consumer.batchOf(followedIn(alpha, 'fact-1'), 'fact-1', 100))).toEqual({
      deliveries: [],
      through: 'fact-1',
      more: false,
    });
  });

  it('are due as one item a playbook that calls out, performed once, and then owed no more', async () => {
    const rounds = roundsOver(aLedger());
    await asked(rounds, followedIn(alpha, 'fact-1'));
    await asked(rounds, followedIn(alpha, 'fact-2'));

    expect(await run(rounds.dueWork.due(nine, 16, false))).toEqual([]);
    expect(await performedAt(rounds, nine)).toEqual([`${JSON.stringify(['acme', 'alpha'])} true`]);
    expect(rounds.rounds).toEqual([alpha]);
    expect(await performedAt(rounds, nine)).toEqual([]);
  });

  it('keep a playbook owed when a fact asks again during its round', async () => {
    const performed: PlaybookAddress[] = [];
    const rounds = roundsAskingAgainOnce(aLedger(), (playbook) => {
      performed.push(playbook);
    });
    await asked(rounds, followedIn(alpha, 'fact-0'));
    await performedAt(rounds, nine);
    await performedAt(rounds, nine);

    expect(performed).toEqual([alpha, alpha]);
    expect(await performedAt(rounds, nine)).toEqual([]);
  });
});

describe('a round of the subscriptions due by the record', () => {
  it('is due at once after a fact about a subscription, and again when its last round answers', async () => {
    const ledger = aLedger();
    await madeAt(ledger, alpha);
    await madeAt(ledger, beta);
    const rounds = roundsOver(ledger, { nextDueAt: nine + 30 * minute });

    expect(await run(rounds.dueWork.nextDueAt(nine - minute))).toBe(nine);
    expect(await run(rounds.dueWork.nextDueAt(nine - minute, false))).toBeNull();
    expect((await performedAt(rounds, nine)).length).toBe(2);
    expect(rounds.rounds).toEqual([alpha, beta]);
    expect(await performedAt(rounds, nine + minute)).toEqual([]);
    expect(await run(rounds.dueWork.nextDueAt(nine))).toBe(nine + 30 * minute);
  });

  it('is due again after the resync period, from the time it was performed, when its round answers no time', async () => {
    const ledger = aLedger();
    await madeAt(ledger, alpha);
    await performedAt(roundsOver(ledger), nine + minute);

    expect(await run(roundsOver(ledger).dueWork.nextDueAt(nine + minute))).toBe(nine + minute + resyncedAfterMs);
  });
});

describe('the playbooks the rounds want the facts of', () => {
  it('are every playbook while the runtime arranges a way, and otherwise one that holds a subscription', async () => {
    const ledger = aLedger();
    await madeAt(ledger, alpha);
    const closed = roundsOver(ledger).consumer;
    const open = roundsOver(ledger, {}, true).consumer;

    expect(
      await Promise.all([
        run(closed.wants('playbook/acme/alpha/')),
        run(closed.wants('playbook/acme/beta/')),
        run(closed.wants('org/acme/')),
        run(open.wants('playbook/acme/beta/')),
      ]),
    ).toEqual([true, false, false, true]);
  });
});

const recordedNow: RecordWork = () => Effect.succeed({ id: 'fact-1', at: acted.at });

const lineage = { causationId: null, correlationId: 'run-1' };

async function recordedThrough(rounds: SubscriptionRounds, work: Work): Promise<void> {
  await run(rounds.recording(recordedNow)({ ...alpha, id: 'run-1' }, work, lineage));
}

describe('the work a request records', () => {
  it('owes its playbook a round once the request is delivered or answered, and not for the rest of its work', async () => {
    const delivered = roundsOver(aLedger(), {}, true);
    const answered = roundsOver(aLedger(), {}, true);
    const started = roundsOver(aLedger(), {}, true);
    await recordedThrough(delivered, { type: 'work', fact: { type: 'delivery_succeeded', data: {} } });
    await recordedThrough(answered, { type: 'answer', answer: { answer: 'approve' } });
    await recordedThrough(started, { type: 'work', fact: { type: 'delivery_started', data: {} } });

    expect((await performedAt(delivered, nine)).length).toBe(1);
    expect((await performedAt(answered, nine)).length).toBe(1);
    expect(await performedAt(started, nine)).toEqual([]);
  });
});

describe('the work a request records on a runtime that arranges no way', () => {
  it('owes no round, so a delivery costs nothing more than before', async () => {
    const rounds = roundsOver(aLedger());
    await recordedThrough(rounds, { type: 'work', fact: { type: 'delivery_succeeded', data: {} } });

    expect(await performedAt(rounds, nine)).toEqual([]);
  });
});
