import { SQL } from '@event-driven-io/dumbo';
import { projectedTableOf, type HeldDigests } from '@on.auto/operations';
import { Schema } from 'effect';

import { chunksOf } from '../connection/bound-values.ts';
import { keptShelf } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import type { HeldHead } from './held-heads.ts';

export const contentReferences = { name: 'content_references', version: 1 };

export const referencesTable = projectedTableOf(contentReferences);

const table = SQL.plain(referencesTable);

export interface ReferencesPlace {
  readonly prefix: string;
  readonly stream: string;
}

const HeldRows = Schema.Array(Schema.Struct({ sha256: Schema.String, held: Schema.Number }));

export function referencesCreated(dialect: ProjectionDialect): readonly SQL[] {
  const { text, integer } = dialect.columnTypes;
  return [
    SQL`CREATE TABLE IF NOT EXISTS ${table} (
      playbook_key ${SQL.plain(text)} NOT NULL,
      stream ${SQL.plain(text)} NOT NULL,
      sha256 ${SQL.plain(text)} NOT NULL,
      held ${SQL.plain(integer)} NOT NULL,
      PRIMARY KEY (playbook_key, stream, sha256)
    )`,
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(`${referencesTable}_by_digest`)} ON ${table} (playbook_key, sha256)`,
  ];
}

async function heldRowsOf(execute: StatementExecutor, sql: SQL): Promise<HeldDigests> {
  const { rows } = await execute.query(sql);
  return new Map(Schema.decodeUnknownSync(HeldRows)(rows).map(({ sha256, held }) => [sha256, held]));
}

export function heldInTheStream(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  { prefix, stream }: ReferencesPlace,
): Promise<HeldDigests> {
  return heldRowsOf(
    execute,
    SQL`SELECT sha256, ${SQL.plain(dialect.asNumber('held'))} AS held FROM ${table}
      WHERE playbook_key = ${prefix} AND stream = ${stream}`,
  );
}

export async function heldOfTheDigests(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  { prefix, stream }: ReferencesPlace,
  digests: readonly string[],
): Promise<HeldDigests> {
  const held = new Map<string, number>();
  await inTurn(digests, async (sha256) => {
    const [row] = await heldRowsOf(
      execute,
      SQL`SELECT sha256, ${SQL.plain(dialect.asNumber('held'))} AS held FROM ${table}
        WHERE playbook_key = ${prefix} AND stream = ${stream} AND sha256 = ${sha256}`,
    );
    if (row !== undefined) {
      held.set(...row);
    }
  });
  return held;
}

interface HeldRow {
  readonly sha256: string;
  readonly held: number;
}

export async function heldWritten(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  { prefix, stream }: ReferencesPlace,
  rows: readonly HeldRow[],
): Promise<void> {
  await inTurn(chunksOf(rows, dialect.rowsInAWrite(2)), (chunk) =>
    execute.command(
      SQL`INSERT INTO ${table} (playbook_key, stream, sha256, held)
        VALUES ${SQL.merge(
          chunk.map(({ sha256, held }) => SQL`(${prefix}, ${stream}, ${sha256}, ${held})`),
          ', ',
        )}
        ON CONFLICT (playbook_key, stream, sha256) DO UPDATE SET held = excluded.held`,
    ),
  );
}

export async function heldDeleted(
  execute: StatementExecutor,
  { prefix, stream }: ReferencesPlace,
  digests: readonly string[],
): Promise<void> {
  await inTurn(digests, (sha256) =>
    execute.command(
      SQL`DELETE FROM ${table} WHERE playbook_key = ${prefix} AND stream = ${stream} AND sha256 = ${sha256}`,
    ),
  );
}

export async function digestsLocked(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  prefix: string,
  digests: readonly string[],
): Promise<void> {
  await inTurn(
    digests.flatMap((sha256) => dialect.keyLocks(referencesTable, prefix, sha256)),
    (lock) => execute.query(lock),
  );
}

interface DigestsOfAPlaybook {
  readonly prefix: string;
  readonly digests: readonly string[];
}

function digestsOf(locking: readonly DigestsOfAPlaybook[], playbook: string): readonly string[] {
  return [...new Set(locking.filter(({ prefix }) => prefix === playbook).flatMap(({ digests }) => digests))].toSorted();
}

export async function digestsLockedInOrder(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  locking: readonly DigestsOfAPlaybook[],
): Promise<void> {
  await inTurn([...new Set(locking.map(({ prefix }) => prefix))].toSorted(), (prefix) =>
    digestsLocked(execute, dialect, prefix, digestsOf(locking, prefix)),
  );
}

const headsTable = SQL.identifier(keptShelf.heads);

const digestsInAStatement = 500;

const HeadedRows = Schema.Array(Schema.Struct({ sha256: Schema.String }));

export async function digestsWithoutAHead(
  execute: StatementExecutor,
  prefix: string,
  digests: readonly string[],
): Promise<readonly string[]> {
  const headed = new Set<string>();
  await inTurn(chunksOf([...new Set(digests)], digestsInAStatement), async (chunk) => {
    const { rows } = await execute.query(
      SQL`SELECT sha256 FROM ${headsTable}
        WHERE playbook_key = ${prefix} AND removing_since IS NULL AND erased_at IS NULL
          AND sha256 IN (${SQL.merge(
            chunk.map((sha256) => SQL`${sha256}`),
            ', ',
          )})`,
    );
    for (const { sha256 } of Schema.decodeUnknownSync(HeadedRows)(rows)) {
      headed.add(sha256);
    }
  });
  return digests.filter((sha256) => !headed.has(sha256));
}

export async function isHeldIn(execute: StatementExecutor, prefix: string, sha256: string): Promise<boolean> {
  const { rows } = await execute.query(
    SQL`SELECT 1 AS held FROM ${table} WHERE playbook_key = ${prefix} AND sha256 = ${sha256} AND held > 0 LIMIT 1`,
  );
  return rows.length > 0;
}

const HeldHeadRows = Schema.Array(
  Schema.Struct({ playbook_key: Schema.String, sha256: Schema.String, kept_in: Schema.NullOr(Schema.String) }),
);

export async function firstHeldHeads(
  read: (sql: SQL) => Promise<readonly unknown[]>,
  most: number,
): Promise<readonly HeldHead[]> {
  const rows = await read(
    SQL`SELECT held.playbook_key, held.sha256, heads.kept_in
      FROM (
        SELECT DISTINCT playbook_key, sha256 FROM ${table} WHERE held > 0 ORDER BY playbook_key, sha256 LIMIT ${most}
      ) AS held
      LEFT JOIN ${headsTable} AS heads ON heads.playbook_key = held.playbook_key AND heads.sha256 = held.sha256
      WHERE heads.erased_at IS NULL
      ORDER BY held.playbook_key, held.sha256`,
  );
  return Schema.decodeUnknownSync(HeldHeadRows)(rows).map(({ playbook_key: playbookKey, sha256, kept_in: keptIn }) => ({
    playbookKey,
    sha256,
    keptIn: keptIn ?? undefined,
  }));
}
