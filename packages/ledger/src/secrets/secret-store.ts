import { SQL } from '@event-driven-io/dumbo';
import { randomUUIDv7 } from '@on.auto/operations';
import { DateTime, Effect, Redacted, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { sealedSecrets } from './sealed-secrets.ts';
import { kidOfSealed, sealedUnder, unsealedWith } from './sealing.ts';
import { secretKeyUnknown, type SecretKeyUnknown } from './secret-key-unknown.ts';
import type { Keyring, SealingKey } from './secret-keys.ts';
import { SecretRefused } from './secret-refused.ts';

const mostSecretBytes = 8192;

const rowsInABatch = 100;

const firstVersion = 1;

export interface StoredSecret {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export type Replacement = { readonly replaced: true; readonly version: number } | { readonly replaced: false };

export type Claim = { readonly claimed: true; readonly until: string } | { readonly claimed: false };

export interface SecretStore {
  readonly kid: string;
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

interface Rotation {
  readonly current: SealingKey;
  readonly previous: SealingKey;
}

interface Replacing {
  readonly id: string;
  readonly version: number;
  readonly value: string;
}

const StoredRows = Schema.Array(
  Schema.Struct({ sealed: Schema.String, version: Schema.Number, claimed_until: Schema.NullOr(Schema.String) }),
);

const VersionRows = Schema.Array(Schema.Struct({ version: Schema.Number }));

const PreviouslySealedRows = Schema.Array(
  Schema.Struct({ id: Schema.String, sealed: Schema.String, version: Schema.Number }),
);

const EndingRows = Schema.Array(Schema.Struct({ id: Schema.String, ends_with: Schema.String }));

const now: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

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

function refusedOr<A>(
  value: Redacted.Redacted,
  kept: (value: string) => Effect.Effect<A>,
): Effect.Effect<A, SecretRefused> {
  return Effect.suspend(() => {
    const refusal = refusalOf(Redacted.value(value));
    return refusal === undefined ? kept(Redacted.value(value)) : Effect.fail(refusal);
  });
}

function queried(execute: StatementExecutor, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.query(sql)).rows);
}

function commanded(execute: StatementExecutor, sql: SQL): Effect.Effect<void> {
  return Effect.asVoid(Effect.promise(() => execute.command(sql)));
}

function claimOpenAt(moment: string): SQL {
  return SQL`claimed_until IS NOT NULL AND claimed_until > ${moment}`;
}

function keptUnder(
  execute: StatementExecutor,
  key: SealingKey,
  value: string,
  endsWith: string | undefined,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const id = randomUUIDv7();
    const sealed = yield* Effect.promise(() => sealedUnder(key, value));
    const keptAt = yield* now;
    yield* commanded(
      execute,
      SQL`INSERT INTO ${sealedSecrets} (id, kid, sealed, version, kept_at, ends_with)
        VALUES (${id}, ${key.kid}, ${sealed}, ${firstVersion}, ${keptAt}, ${endsWith ?? null})`,
    );
    return id;
  });
}

function replacedUnder(execute: StatementExecutor, key: SealingKey, replacing: Replacing): Effect.Effect<Replacement> {
  return Effect.gen(function* () {
    const sealed = yield* Effect.promise(() => sealedUnder(key, replacing.value));
    const keptAt = yield* now;
    const [row] = Schema.decodeUnknownSync(VersionRows)(
      yield* queried(
        execute,
        SQL`UPDATE ${sealedSecrets}
          SET kid = ${key.kid}, sealed = ${sealed}, version = version + 1, kept_at = ${keptAt},
            claimed_until = NULL, ends_with = NULL
          WHERE id = ${replacing.id} AND version = ${replacing.version} RETURNING version`,
      ),
    );
    return row === undefined ? { replaced: false } : { replaced: true, version: row.version };
  });
}

function claimedOn(execute: StatementExecutor, id: string, version: number, lastingMs: number): Effect.Effect<Claim> {
  return Effect.gen(function* () {
    const moment = yield* DateTime.now;
    const until = DateTime.formatIso(DateTime.addDuration(moment, lastingMs));
    const claimed = yield* queried(
      execute,
      SQL`UPDATE ${sealedSecrets} SET claimed_until = ${until}
        WHERE id = ${id} AND version = ${version} AND NOT (${claimOpenAt(DateTime.formatIso(moment))}) RETURNING id`,
    );
    return claimed.length === 0 ? { claimed: false } : { claimed: true, until };
  });
}

function endingsOn(execute: StatementExecutor, ids: readonly string[]): Effect.Effect<ReadonlyMap<string, string>> {
  if (ids.length === 0) {
    return Effect.succeed(new Map());
  }
  const named = SQL.merge(
    ids.map((id) => SQL`${id}`),
    ', ',
  );
  return Effect.map(
    queried(execute, SQL`SELECT id, ends_with FROM ${sealedSecrets} WHERE id IN (${named}) AND ends_with IS NOT NULL`),
    (rows) => new Map(Schema.decodeUnknownSync(EndingRows)(rows).map(({ id, ends_with: endsWith }) => [id, endsWith])),
  );
}

function unsealed(keyring: Keyring, sealed: string): Effect.Effect<string, SecretKeyUnknown> {
  return Effect.suspend(() => {
    const kid = kidOfSealed(sealed);
    const key = keyring.named(kid);
    return key === undefined ? Effect.fail(secretKeyUnknown(kid)) : Effect.promise(() => unsealedWith(key, sealed));
  });
}

function readOn(
  execute: StatementExecutor,
  keyring: Keyring,
  id: string,
): Effect.Effect<StoredSecret | undefined, SecretKeyUnknown> {
  const rowsAt = (moment: string) =>
    queried(
      execute,
      SQL`SELECT sealed, version, CASE WHEN ${claimOpenAt(moment)} THEN claimed_until END AS claimed_until
        FROM ${sealedSecrets} WHERE id = ${id}`,
    );
  return Effect.flatMap(Effect.flatMap(now, rowsAt), (rows) => {
    const row = Schema.decodeUnknownSync(StoredRows)(rows).at(0);
    return row === undefined
      ? Effect.undefined
      : Effect.map(unsealed(keyring, row.sealed), (value) => ({
          value: Redacted.make(value),
          version: row.version,
          claimedUntil: row.claimed_until ?? undefined,
        }));
  });
}

function resealedRow(
  execute: StatementExecutor,
  { current, previous }: Rotation,
  { id, sealed, version }: { readonly id: string; readonly sealed: string; readonly version: number },
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const value = yield* Effect.promise(() => unsealedWith(previous, sealed));
    const resealed = yield* Effect.promise(() => sealedUnder(current, value));
    const updated = yield* queried(
      execute,
      SQL`UPDATE ${sealedSecrets} SET kid = ${current.kid}, sealed = ${resealed}
        WHERE id = ${id} AND kid = ${previous.kid} AND version = ${version} RETURNING id`,
    );
    return updated.length;
  });
}

function resealedInBatches(execute: StatementExecutor, rotation: Rotation, before: number): Effect.Effect<number> {
  return Effect.gen(function* () {
    const rows = Schema.decodeUnknownSync(PreviouslySealedRows)(
      yield* queried(
        execute,
        SQL`SELECT id, sealed, version FROM ${sealedSecrets} WHERE kid = ${rotation.previous.kid}
          ORDER BY id LIMIT ${rowsInABatch}`,
      ),
    );
    const counts = yield* Effect.forEach(rows, (row) => resealedRow(execute, rotation, row));
    const resealed = counts.reduce((sum, count) => sum + count, before);
    return rows.length < rowsInABatch ? resealed : yield* resealedInBatches(execute, rotation, resealed);
  });
}

export function secretStoreOn(execute: StatementExecutor, keyring: Keyring, close: () => Promise<void>): SecretStore {
  const { current, previous } = keyring;
  return {
    kid: current.kid,
    keep: (value, endsWith) => refusedOr(value, (text) => keptUnder(execute, current, text, endsWith)),
    read: (id) => readOn(execute, keyring, id),
    replace: (id, version, value) =>
      refusedOr(value, (text) => replacedUnder(execute, current, { id, version, value: text })),
    claim: (id, version, lastingMs) => claimedOn(execute, id, version, lastingMs),
    endingsOf: (ids) => endingsOn(execute, ids),
    forget: (id) => commanded(execute, SQL`DELETE FROM ${sealedSecrets} WHERE id = ${id}`),
    rotated: () => (previous === undefined ? Effect.succeed(0) : resealedInBatches(execute, { current, previous }, 0)),
    close,
  };
}
