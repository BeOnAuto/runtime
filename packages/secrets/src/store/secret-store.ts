import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import type { Custodians } from '../custodians/custodian.ts';
import type { Keeper } from '../keepers/keeper.ts';
import type { SecretKeyUnknown } from '../keepers/secret-key-unknown.ts';
import type { Claim, Replacement, SecretRows } from '../rows/secret-rows.ts';
import { rotatedOn } from './rotation.ts';
import { SecretRefused } from './secret-refused.ts';

const mostSecretBytes = 8192;

export interface StoredSecret {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export interface SecretStore {
  readonly keep: (value: Redacted.Redacted, endsWith?: string) => Effect.Effect<string, SecretRefused>;
  readonly read: (id: string) => Effect.Effect<StoredSecret | undefined, SecretKeyUnknown>;
  readonly replace: (
    id: string,
    version: number,
    value: Redacted.Redacted,
  ) => Effect.Effect<Replacement, SecretRefused>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<Claim>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<void>;
  readonly rotated: () => Effect.Effect<number>;
  readonly close: () => Promise<void>;
}

function refusalOf(value: string): SecretRefused | undefined {
  if (value === '') {
    return new SecretRefused({ because: 'empty', detail: 'A secret to keep is empty' });
  }
  return Buffer.byteLength(value) > mostSecretBytes
    ? new SecretRefused({
        because: 'too_large',
        detail: `A secret to keep holds more than ${mostSecretBytes / 1024} KiB`,
      })
    : undefined;
}

function refusedOr<A>(value: Redacted.Redacted, kept: () => Effect.Effect<A>): Effect.Effect<A, SecretRefused> {
  return Effect.suspend(() => {
    const refusal = refusalOf(Redacted.value(value));
    return refusal === undefined ? kept() : Effect.fail(refusal);
  });
}

function keptBy(
  rows: SecretRows,
  keeper: Keeper,
  value: Redacted.Redacted,
  endsWith: string | undefined,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const id = randomUUIDv7();
    const holding = yield* keeper.hold(id, value);
    yield* rows.keep(id, holding, endsWith);
    return id;
  });
}

function readBy(
  rows: SecretRows,
  keeper: Keeper,
  id: string,
): Effect.Effect<StoredSecret | undefined, SecretKeyUnknown> {
  return Effect.flatMap(rows.read(id), (row) =>
    row === undefined
      ? Effect.undefined
      : Effect.map(keeper.reveal(row.holding), (value) => ({
          value,
          version: row.version,
          claimedUntil: row.claimedUntil,
        })),
  );
}

function forgottenBy(rows: SecretRows, keeper: Keeper, id: string): Effect.Effect<void> {
  return Effect.flatMap(rows.forget(id), (holding) => (holding === undefined ? Effect.void : keeper.release(holding)));
}

export function secretStoreOn(rows: SecretRows, keeper: Keeper, custodians: Custodians): SecretStore {
  return {
    keep: (value, endsWith) => refusedOr(value, () => keptBy(rows, keeper, value, endsWith)),
    read: (id) => readBy(rows, keeper, id),
    replace: (id, version, value) =>
      refusedOr(value, () => Effect.flatMap(keeper.hold(id, value), (holding) => rows.replace(id, version, holding))),
    claim: rows.claim,
    endingsOf: rows.endingsOf,
    forget: (id) => forgottenBy(rows, keeper, id),
    rotated: () => rotatedOn(rows, custodians),
    close: rows.close,
  };
}
