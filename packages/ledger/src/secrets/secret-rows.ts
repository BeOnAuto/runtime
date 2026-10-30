import { SQL } from '@event-driven-io/dumbo';
import type { Claim, HeldRow, Holder, Holding, Replacement, SecretRow, SecretRows } from '@on.auto/secrets';
import { DateTime, Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { keptSecrets } from './kept-secrets.ts';

const firstVersion = 1;

const HoldingColumns = {
  kept_by: Schema.String,
  held: Schema.String,
  wrapped_key: Schema.NullOr(Schema.String),
  kid: Schema.NullOr(Schema.String),
};

const ReadRows = Schema.Array(
  Schema.Struct({ ...HoldingColumns, version: Schema.Number, claimed_until: Schema.NullOr(Schema.String) }),
);

const HeldRows = Schema.Array(Schema.Struct({ ...HoldingColumns, id: Schema.String, version: Schema.Number }));

const HoldingRows = Schema.Array(Schema.Struct(HoldingColumns));

const VersionRows = Schema.Array(Schema.Struct({ version: Schema.Number }));

const EndingRows = Schema.Array(Schema.Struct({ id: Schema.String, ends_with: Schema.String }));

type HoldingRow = (typeof HoldingRows.Type)[number];

const holdingColumns = SQL`kept_by, held, wrapped_key, kid`;

const now: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

function holdingOf({ kept_by, held, wrapped_key, kid }: HoldingRow): Holding {
  return { keptBy: kept_by, held, wrappedKey: wrapped_key ?? undefined, kid: kid ?? undefined };
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

function heldAs({ keptBy, held, wrappedKey, kid }: Holding): SQL {
  return SQL`kept_by = ${keptBy}, held = ${held}, wrapped_key = ${wrappedKey ?? null}, kid = ${kid ?? null}`;
}

function stillHolding({ id, version, holding }: HeldRow): SQL {
  return SQL`id = ${id} AND version = ${version} AND kept_by = ${holding.keptBy} AND held = ${holding.held}
    AND COALESCE(wrapped_key, '') = ${holding.wrappedKey ?? ''} AND COALESCE(kid, '') = ${holding.kid ?? ''}`;
}

function keptOn(execute: StatementExecutor, id: string, holding: Holding, endsWith?: string): Effect.Effect<void> {
  return Effect.flatMap(now, (keptAt) =>
    commanded(
      execute,
      SQL`INSERT INTO ${keptSecrets} (id, version, kept_at, ends_with, kept_by, held, wrapped_key, kid)
        VALUES (${id}, ${firstVersion}, ${keptAt}, ${endsWith ?? null}, ${holding.keptBy}, ${holding.held},
          ${holding.wrappedKey ?? null}, ${holding.kid ?? null})`,
    ),
  );
}

function readOn(execute: StatementExecutor, id: string): Effect.Effect<SecretRow | undefined> {
  return Effect.map(
    Effect.flatMap(now, (moment) =>
      queried(
        execute,
        SQL`SELECT ${holdingColumns}, version, CASE WHEN ${claimOpenAt(moment)} THEN claimed_until END AS claimed_until
          FROM ${keptSecrets} WHERE id = ${id}`,
      ),
    ),
    (rows) => {
      const row = Schema.decodeUnknownSync(ReadRows)(rows).at(0);
      return row === undefined
        ? undefined
        : { holding: holdingOf(row), version: row.version, claimedUntil: row.claimed_until ?? undefined };
    },
  );
}

function replacedOn(
  execute: StatementExecutor,
  { id, version }: { readonly id: string; readonly version: number },
  holding: Holding,
): Effect.Effect<Replacement> {
  return Effect.gen(function* () {
    const keptAt = yield* now;
    const [row] = Schema.decodeUnknownSync(VersionRows)(
      yield* queried(
        execute,
        SQL`UPDATE ${keptSecrets}
          SET ${heldAs(holding)}, version = version + 1, kept_at = ${keptAt}, claimed_until = NULL, ends_with = NULL
          WHERE id = ${id} AND version = ${version} RETURNING version`,
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
      SQL`UPDATE ${keptSecrets} SET claimed_until = ${until}
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
    queried(execute, SQL`SELECT id, ends_with FROM ${keptSecrets} WHERE id IN (${named}) AND ends_with IS NOT NULL`),
    (rows) => new Map(Schema.decodeUnknownSync(EndingRows)(rows).map(({ id, ends_with: endsWith }) => [id, endsWith])),
  );
}

function forgottenOn(execute: StatementExecutor, id: string): Effect.Effect<Holding | undefined> {
  return Effect.map(
    queried(execute, SQL`DELETE FROM ${keptSecrets} WHERE id = ${id} RETURNING ${holdingColumns}`),
    (rows) => {
      const row = Schema.decodeUnknownSync(HoldingRows)(rows).at(0);
      return row === undefined ? undefined : holdingOf(row);
    },
  );
}

interface Asked {
  readonly limit: number;
  readonly after: string | undefined;
}

function heldOn(
  execute: StatementExecutor,
  { keptBy, kid }: Holder,
  { limit, after }: Asked,
): Effect.Effect<readonly HeldRow[]> {
  const underTheKid = kid === undefined ? SQL.EMPTY : SQL` AND kid = ${kid}`;
  const afterTheId = after === undefined ? SQL.EMPTY : SQL` AND id > ${after}`;
  return Effect.map(
    queried(
      execute,
      SQL`SELECT id, version, ${holdingColumns} FROM ${keptSecrets} WHERE kept_by = ${keptBy}${underTheKid}${afterTheId}
        ORDER BY id LIMIT ${limit}`,
    ),
    (rows) =>
      Schema.decodeUnknownSync(HeldRows)(rows).map((row) => ({
        id: row.id,
        version: row.version,
        holding: holdingOf(row),
      })),
  );
}

function reheldOn(execute: StatementExecutor, read: HeldRow, holding: Holding): Effect.Effect<boolean> {
  return Effect.map(
    queried(execute, SQL`UPDATE ${keptSecrets} SET ${heldAs(holding)} WHERE ${stillHolding(read)} RETURNING id`),
    (rows) => rows.length > 0,
  );
}

export function secretRowsOn(execute: StatementExecutor, close: () => Promise<void>): SecretRows {
  return {
    keep: (id, holding, endsWith) => keptOn(execute, id, holding, endsWith),
    read: (id) => readOn(execute, id),
    replace: (id, version, holding) => replacedOn(execute, { id, version }, holding),
    claim: (id, version, lastingMs) => claimedOn(execute, id, version, lastingMs),
    endingsOf: (ids) => endingsOn(execute, ids),
    forget: (id) => forgottenOn(execute, id),
    heldBy: (holder, limit, after) => heldOn(execute, holder, { limit, after }),
    reheld: (read, holding) => reheldOn(execute, read, holding),
    close,
  };
}
