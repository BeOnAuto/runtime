import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import type { Custodians } from '../custodians/custodian.ts';
import type { Keeper, KeepingFailure, ReadingFailure } from '../keepers/keeper.ts';
import type { Claim, Replacement, SecretRows } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from './answer-bound.ts';
import { rotatedOn } from './rotation.ts';
import { SecretRefused } from './secret-refused.ts';

const mostSecretBytes = 8192;

export interface StoredSecret {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export interface SecretStore {
  readonly keep: (value: Redacted.Redacted, endsWith?: string) => Effect.Effect<string, SecretRefused | KeepingFailure>;
  readonly read: (id: string) => Effect.Effect<StoredSecret | undefined, ReadingFailure>;
  readonly replace: (
    id: string,
    version: number,
    value: Redacted.Redacted,
  ) => Effect.Effect<Replacement, SecretRefused | KeepingFailure>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<Claim>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<void>;
  readonly rotated: () => Effect.Effect<number, KeepingFailure>;
  readonly close: () => Promise<void>;
}

interface Asked {
  readonly id: string;
  readonly version: number;
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

function refusedOr<A, E>(
  value: Redacted.Redacted,
  kept: () => Effect.Effect<A, E>,
): Effect.Effect<A, E | SecretRefused> {
  return Effect.suspend((): Effect.Effect<A, E | SecretRefused> => {
    const refusal = refusalOf(Redacted.value(value));
    return refusal === undefined ? kept() : Effect.fail(refusal);
  });
}

function keptBy(
  rows: SecretRows,
  keeper: Keeper,
  value: Redacted.Redacted,
  endsWith: string | undefined,
): Effect.Effect<string, KeepingFailure> {
  return Effect.gen(function* () {
    const id = randomUUIDv7();
    const holding = yield* answeredWithinItsBound(keeper.hold(id, value));
    yield* rows.keep(id, holding, endsWith);
    return id;
  });
}

function readBy(rows: SecretRows, keeper: Keeper, id: string): Effect.Effect<StoredSecret | undefined, ReadingFailure> {
  return Effect.flatMap(rows.read(id), (row) =>
    row === undefined
      ? Effect.undefined
      : Effect.map(answeredWithinItsBound(keeper.reveal(row.holding)), (value) => ({
          value,
          version: row.version,
          claimedUntil: row.claimedUntil,
        })),
  );
}

function replacedBy(
  rows: SecretRows,
  keeper: Keeper,
  { id, version }: Asked,
  value: Redacted.Redacted,
): Effect.Effect<Replacement, KeepingFailure> {
  return Effect.flatMap(answeredWithinItsBound(keeper.hold(id, value)), (holding) =>
    rows.replace(id, version, holding),
  );
}

function forgottenBy(rows: SecretRows, keeper: Keeper, id: string): Effect.Effect<void> {
  return Effect.flatMap(rows.forget(id), (holding) => (holding === undefined ? Effect.void : keeper.release(holding)));
}

export function secretStoreOn(rows: SecretRows, keeper: Keeper, custodians: Custodians): SecretStore {
  return {
    keep: (value, endsWith) => refusedOr(value, () => keptBy(rows, keeper, value, endsWith)),
    read: (id) => readBy(rows, keeper, id),
    replace: (id, version, value) => refusedOr(value, () => replacedBy(rows, keeper, { id, version }, value)),
    claim: rows.claim,
    endingsOf: rows.endingsOf,
    forget: (id) => forgottenBy(rows, keeper, id),
    rotated: () => rotatedOn(rows, custodians),
    close: rows.close,
  };
}
