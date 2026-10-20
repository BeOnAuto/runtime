import { DateTime, Effect, Option, Redacted, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { onTestFinished } from 'vitest';

import type { Custodian, Custodians } from '../custodians/custodian.ts';
import { localCustodian } from '../custodians/local-custodian.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import type { SecretRows } from '../rows/secret-rows.ts';
import { secretStoreOn, type SecretStore } from '../store/secret-store.ts';
import { memoryRows, type MemoryRows } from './memory-rows.ts';
import { aSecretsKey } from './recording-custodian.ts';

export interface SecretsEntry {
  readonly aDatabase: () => Promise<string>;
  readonly rowsOn: (database: string) => Effect.Effect<SecretRows>;
  readonly rowsIn: (database: string) => Promise<readonly unknown[]>;
}

export interface TestCustodians {
  readonly aCustodian: () => Promise<Custodian>;
}

export const localCustodians: TestCustodians = {
  aCustodian: () => Promise.resolve(localCustodian(aSecretsKey())),
};

const KeptRows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    version: Schema.Number,
    kept_at: Schema.String,
    claimed_until: Schema.NullOr(Schema.String),
    ends_with: Schema.NullOr(Schema.String),
    kept_by: Schema.String,
    held: Schema.String,
    wrapped_key: Schema.NullOr(Schema.String),
    kid: Schema.NullOr(Schema.String),
  }),
);

export const firstMoment = Date.parse('2026-10-19T09:00:00.000Z');

export const aLease = 30_000;

export function isoOf(moment: number): string {
  return new Date(moment).toISOString();
}

export function at<A, E>(moment: number, effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(Effect.andThen(TestClock.setTime(moment), effect).pipe(Effect.provide(TestClock.layer())));
}

export async function rowsOpenedOn(entry: SecretsEntry, database: string): Promise<SecretRows> {
  const rows = await Effect.runPromise(entry.rowsOn(database));
  onTestFinished(() => rows.close());
  return rows;
}

export async function storeWith(entry: SecretsEntry, database: string, custodians: Custodians): Promise<SecretStore> {
  return secretStoreOn(await rowsOpenedOn(entry, database), sealedKeeper(custodians), custodians);
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
  return Option.getOrUndefined(
    Option.map(Option.fromNullishOr(await at(moment, store.read(id))), ({ value, version, claimedUntil }) => ({
      value: Redacted.value(value),
      version,
      claimedUntil,
    })),
  );
}

export async function rowsIn(entry: SecretsEntry, database: string) {
  return Schema.decodeUnknownSync(KeptRows)(await entry.rowsIn(database));
}

export async function kidsIn(entry: SecretsEntry, database: string): Promise<Readonly<Record<string, number>>> {
  const counted: Record<string, number> = {};
  for (const { kid } of await rowsIn(entry, database)) {
    counted[String(kid)] = (counted[String(kid)] ?? 0) + 1;
  }
  return counted;
}

export function inMemoryEntry(): SecretsEntry {
  const databases = new Map<string, MemoryRows>();
  const rowsNamed = (database: string) => Option.getOrThrow(Option.fromNullishOr(databases.get(database)));
  return {
    aDatabase: () => {
      const database = `memory-${databases.size + 1}`;
      databases.set(database, memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) }));
      return Promise.resolve(database);
    },
    rowsOn: (database) => Effect.sync(() => rowsNamed(database)),
    rowsIn: (database) => Promise.resolve(rowsNamed(database).kept()),
  };
}
