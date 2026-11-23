import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { subscriptionRecordsOf } from './subscription-records.ts';
import { eventSubscriptions } from './subscription-rows.ts';
import { playbooksDueOf } from './subscription-schedule.ts';
import { checksWokenOf } from './woken-checks.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-11-23T09:00:00.000Z');

const minute = 60_000;

const checked = { type: 'polling', declared: 'a'.repeat(64), since: '' } as const;

const hooked = { type: 'webhook', id: 'hook-1', declared: 'b'.repeat(64) } as const;

const listed = { connection: 'notes', topic: 'listed' };

function at<A>(time: number, effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(TestClock.setTime(time).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())));
}

interface Held {
  readonly key: { readonly connection: string; readonly topic: string };
  readonly made: typeof checked | typeof hooked;
  readonly failures: number;
}

async function heldOver(...held: readonly Held[]) {
  const ledger = memoryLedger(undefined, [eventSubscriptions]).service;
  const records = subscriptionRecordsOf(ledger);
  await at(
    nine,
    Effect.forEach(
      held,
      ({ key, made, failures }) =>
        Effect.andThen(records.made(alpha, key, made), records.moved(alpha, key, { failures, dueAt: nine + minute })),
      { discard: true },
    ),
  );
  const dueOf = async () =>
    Object.fromEntries(
      (await Effect.runPromise(records.read(alpha))).map(({ topic, positions }) => [topic, positions?.dueAt]),
    );
  return { ledger, dueOf };
}

describe('a delivery that only tells Auto to read, through a connection whose triggers Auto checks', () => {
  it('makes each check of that connection in the playbook it reached due at once, and its round with it', async () => {
    const { ledger, dueOf } = await heldOver(
      { key: listed, made: checked, failures: 0 },
      { key: { connection: 'notes', topic: 'failing' }, made: checked, failures: 1 },
      { key: { connection: 'notes', topic: 'hooked' }, made: hooked, failures: 0 },
      { key: { connection: 'tracker', topic: 'other' }, made: checked, failures: 0 },
    );
    const woken = nine + 10_000;

    await Effect.runPromise(checksWokenOf(ledger)({ ...alpha, connection: 'notes' }, woken));

    expect(await dueOf()).toEqual({
      listed: woken,
      failing: nine + minute,
      hooked: nine + minute,
      other: nine + minute,
    });
    expect(await Effect.runPromise(playbooksDueOf(ledger, woken, 10))).toEqual([alpha]);
  });

  it('leaves a check due already as it is, never sooner than it was, and wakes nothing where no playbook is named', async () => {
    const { ledger, dueOf } = await heldOver({ key: listed, made: checked, failures: 0 });
    const wake = checksWokenOf(ledger);

    await Effect.runPromise(wake({ org: 'acme', connection: 'notes' }, nine + 10_000));
    await Effect.runPromise(wake({ ...alpha, connection: 'notes' }, nine + 2 * minute));

    expect(await dueOf()).toEqual({ listed: nine + minute });
  });
});
