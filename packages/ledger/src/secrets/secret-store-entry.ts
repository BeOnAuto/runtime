import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';
import { Effect, Redacted, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { onTestFinished } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import type { SecretKeys } from './secret-keys.ts';
import type { SecretStore } from './secret-store.ts';

export interface SecretsEntry extends LedgerEntry {
  readonly secretStoreOn: (database: string, keys: SecretKeys) => Effect.Effect<SecretStore>;
}

type Key = Redacted.Redacted<Uint8Array>;

const SealedRows = Schema.Array(
  Schema.Struct({ id: Schema.String, kid: Schema.String, sealed: Schema.String, kept_at: Schema.String }),
);

export const firstMoment = Date.parse('2026-10-19T09:00:00.000Z');

export const aLease = 30_000;

export function isoOf(moment: number): string {
  return new Date(moment).toISOString();
}

export function at<A, E>(moment: number, effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(Effect.andThen(TestClock.setTime(moment), effect).pipe(Effect.provide(TestClock.layer())));
}

export function aKey(): Key {
  return Redacted.make(new Uint8Array(randomBytes(32)));
}

export function kidOf(key: Key): string {
  return sha256Of(Redacted.value(key)).slice(0, 16);
}

export async function aDatabaseWithItsLedger(entry: SecretsEntry): Promise<string> {
  const database = await entry.aDatabase();
  await aLedger(entry, database);
  return database;
}

export async function aStoreOn(entry: SecretsEntry, database: string, keys: SecretKeys): Promise<SecretStore> {
  const store = await Effect.runPromise(entry.secretStoreOn(database, keys));
  onTestFinished(() => store.close());
  return store;
}

export function kept(store: SecretStore, value: string): Promise<string> {
  return Effect.runPromise(store.keep(Redacted.make(value)));
}

export function keptEach(store: SecretStore, values: readonly string[]): Promise<readonly string[]> {
  return Effect.runPromise(Effect.forEach(values, (value) => store.keep(Redacted.make(value))));
}

export async function readBack(store: SecretStore, id: string): Promise<string | undefined> {
  const read = await Effect.runPromise(store.read(id));
  return read === undefined ? undefined : Redacted.value(read.value);
}

export async function stateAt(store: SecretStore, id: string, moment: number) {
  const read = await at(moment, store.read(id));
  return read === undefined
    ? undefined
    : { value: Redacted.value(read.value), version: read.version, claimedUntil: read.claimedUntil };
}

export async function rowsIn(entry: SecretsEntry, database: string) {
  return Schema.decodeUnknownSync(SealedRows)(
    await entry.queried(database, 'SELECT id, kid, sealed, kept_at FROM sealed_secrets ORDER BY id'),
  );
}

export async function kidsIn(entry: SecretsEntry, database: string): Promise<Readonly<Record<string, number>>> {
  const counted: Record<string, number> = {};
  for (const { kid } of await rowsIn(entry, database)) {
    counted[kid] = (counted[kid] ?? 0) + 1;
  }
  return counted;
}
