import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import type { Custodians } from '../custodians/custodian.ts';
import type { Keepers, KeepingFailure, ReadingFailure } from '../keepers/keeper.ts';
import type { Claim, Replacement, SecretRows } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from './answer-bound.ts';
import { movedOn, type MoveFailure } from './move.ts';
import { releasedBy, revealedBy } from './named-keepers.ts';
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
  readonly moved: () => Effect.Effect<number, MoveFailure>;
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
  { current }: Keepers,
  value: Redacted.Redacted,
  endsWith: string | undefined,
): Effect.Effect<string, SecretRefused | KeepingFailure> {
  return Effect.gen(function* () {
    const id = randomUUIDv7();
    const holding = yield* answeredWithinItsBound(current.hold(id, value));
    yield* rows.keep(id, holding, endsWith);
    return id;
  });
}

function readBy(
  rows: SecretRows,
  keepers: Keepers,
  id: string,
): Effect.Effect<StoredSecret | undefined, ReadingFailure> {
  return Effect.flatMap(rows.read(id), (row) =>
    row === undefined
      ? Effect.undefined
      : Effect.map(revealedBy(keepers, row.holding), (value) =>
          value === undefined ? undefined : { value, version: row.version, claimedUntil: row.claimedUntil },
        ),
  );
}

function replacedBy(
  rows: SecretRows,
  { current }: Keepers,
  { id, version }: Asked,
  value: Redacted.Redacted,
): Effect.Effect<Replacement, SecretRefused | KeepingFailure> {
  return Effect.flatMap(answeredWithinItsBound(current.hold(id, value)), (holding) =>
    rows.replace(id, version, holding),
  );
}

function forgottenBy(rows: SecretRows, keepers: Keepers, id: string): Effect.Effect<void> {
  return Effect.flatMap(rows.forget(id), (holding) =>
    holding === undefined ? Effect.void : releasedBy(keepers, holding),
  );
}

export function secretStoreOn(rows: SecretRows, keepers: Keepers, custodians?: Custodians): SecretStore {
  return {
    keep: (value, endsWith) => refusedOr(value, () => keptBy(rows, keepers, value, endsWith)),
    read: (id) => readBy(rows, keepers, id),
    replace: (id, version, value) => refusedOr(value, () => replacedBy(rows, keepers, { id, version }, value)),
    claim: rows.claim,
    endingsOf: rows.endingsOf,
    forget: (id) => forgottenBy(rows, keepers, id),
    rotated: () => (custodians === undefined ? Effect.succeed(0) : rotatedOn(rows, custodians)),
    moved: () => movedOn(rows, keepers),
    close: rows.close,
  };
}
