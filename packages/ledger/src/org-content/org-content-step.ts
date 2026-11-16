import { SQL } from '@event-driven-io/dumbo';
import { playbookOfStreamPrefix, streamPrefixOfOrg } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { chunksWithin, mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from '../layout/layout-dialects.ts';
import type { StepInCode } from '../layout/layout-steps.ts';
import { inTurn } from '../projections/inline-projection.ts';

export const headsOfPlaybooks = SQL`CREATE TABLE IF NOT EXISTS recorded_content_heads (
    playbook_key TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    chunks INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    kept_at BIGINT NOT NULL DEFAULT 0,
    kept_in TEXT NOT NULL DEFAULT 'ledger',
    removing_since BIGINT,
    expires_at BIGINT,
    erased_at BIGINT,
    PRIMARY KEY (playbook_key, sha256)
  )`;

export function chunksOfPlaybooks({ dialect }: LayoutDialect): SQL {
  return SQL`CREATE TABLE IF NOT EXISTS recorded_content_chunks (
    playbook_key TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    chunk INTEGER NOT NULL,
    data ${SQL.plain(dialect === 'postgresql' ? 'BYTEA' : 'BLOB')} NOT NULL,
    PRIMARY KEY (playbook_key, upload_id, chunk)
  )`;
}

const headsOfOrgs = SQL`CREATE TABLE IF NOT EXISTS recorded_content_heads (
      org_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      place_key TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      kept_at BIGINT NOT NULL DEFAULT 0,
      kept_in TEXT NOT NULL DEFAULT 'ledger',
      removing_since BIGINT,
      expires_at BIGINT,
      erased_at BIGINT,
      PRIMARY KEY (org_key, sha256)
    )`;

const placesOfOrgs = SQL`CREATE TABLE IF NOT EXISTS recorded_content_places (
      org_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      place_key TEXT NOT NULL,
      PRIMARY KEY (org_key, sha256, place_key)
    )`;

function holdsOfOrgs({ dialect }: LayoutDialect): readonly SQL[] {
  const [text, integer] = dialect === 'postgresql' ? ['text', 'bigint'] : ['TEXT', 'INTEGER'];
  return [
    SQL`CREATE TABLE IF NOT EXISTS content_references_2 (
      org_key ${SQL.plain(text)} NOT NULL,
      playbook_key ${SQL.plain(text)} NOT NULL,
      stream ${SQL.plain(text)} NOT NULL,
      sha256 ${SQL.plain(text)} NOT NULL,
      held ${SQL.plain(integer)} NOT NULL,
      PRIMARY KEY (playbook_key, stream, sha256)
    )`,
    SQL`CREATE INDEX IF NOT EXISTS content_references_2_by_digest ON content_references_2 (playbook_key, sha256)`,
    SQL`CREATE INDEX IF NOT EXISTS content_references_2_by_org_and_digest ON content_references_2 (org_key, sha256)`,
  ];
}

const KeyRows = Schema.Array(Schema.Struct({ playbook_key: Schema.String }));

const Counted = Schema.Union([Schema.Number, Schema.String]);

const CountRows = Schema.Tuple([Schema.Struct({ counted: Counted })]);

const standing = SQL`(heads.upload_id <> '' AND heads.erased_at IS NULL)`;

const wholeChunks = SQL`(heads.kept_in <> 'ledger' OR heads.chunks = (SELECT COUNT(*) FROM recorded_content_chunks AS kept
  WHERE kept.place_key = heads.playbook_key AND kept.upload_id = heads.upload_id))`;

const headsRated = SQL`SELECT owners.org_key AS org_key, heads.sha256 AS sha256, heads.playbook_key AS place_key,
    heads.upload_id AS upload_id, heads.bytes AS bytes, heads.chunks AS chunks, heads.media_type AS media_type,
    heads.kept_at AS kept_at, heads.kept_in AS kept_in, heads.removing_since AS removing_since,
    heads.expires_at AS expires_at, heads.erased_at AS erased_at,
    CASE WHEN ${standing} THEN 1 ELSE 0 END AS stands,
    CASE WHEN ${wholeChunks} THEN 1 ELSE 0 END AS whole
  FROM recorded_content_heads_by_playbook AS heads
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = heads.playbook_key`;

const headsMerged = SQL`INSERT INTO recorded_content_heads
    (org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_at, kept_in, removing_since, expires_at, erased_at)
  SELECT org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_at, kept_in, removing_since, expires_at,
    erased_at
  FROM (
    SELECT org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_in,
      MAX(kept_at) OVER owned AS kept_at,
      CASE WHEN SUM(CASE WHEN stands = 1 AND removing_since IS NULL THEN 1 ELSE 0 END) OVER owned > 0 THEN NULL
        WHEN SUM(stands) OVER owned > 0 THEN MAX(CASE WHEN stands = 1 THEN removing_since END) OVER owned
        ELSE MAX(removing_since) OVER owned END AS removing_since,
      CASE WHEN SUM(CASE WHEN stands = 1 AND expires_at IS NULL THEN 1 ELSE 0 END) OVER owned > 0 THEN NULL
        ELSE MAX(CASE WHEN stands = 1 THEN expires_at END) OVER owned END AS expires_at,
      CASE WHEN SUM(stands) OVER owned > 0 THEN NULL ELSE MAX(erased_at) OVER owned END AS erased_at,
      ROW_NUMBER() OVER (PARTITION BY org_key, sha256 ORDER BY
        stands DESC,
        whole DESC,
        CASE WHEN kept_in = 'ledger' THEN 0 ELSE 1 END,
        CASE WHEN upload_id <> '' THEN 0 ELSE 1 END,
        upload_id,
        place_key) AS chosen
    FROM (${headsRated}) AS rated
    WINDOW owned AS (PARTITION BY org_key, sha256)
  ) AS merged
  WHERE chosen = 1`;

const externalPlacesRecorded = SQL`INSERT INTO recorded_content_places (org_key, sha256, place_key)
  SELECT owners.org_key, heads.sha256, heads.playbook_key
  FROM recorded_content_heads_by_playbook AS heads
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = heads.playbook_key
  WHERE heads.kept_in = 'external' AND ${standing}
  ON CONFLICT (org_key, sha256, place_key) DO NOTHING`;

const headlessPlacesRecorded = SQL`INSERT INTO recorded_content_places (org_key, sha256, place_key)
  SELECT DISTINCT owners.org_key, held.sha256, held.playbook_key
  FROM content_references_1 AS held
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = held.playbook_key
  WHERE held.held > 0 AND NOT EXISTS (SELECT 1 FROM recorded_content_heads_by_playbook AS heads
    WHERE heads.playbook_key = held.playbook_key AND heads.sha256 = held.sha256)
  ON CONFLICT (org_key, sha256, place_key) DO NOTHING`;

const holdsCopied = SQL`INSERT INTO content_references_2 (org_key, playbook_key, stream, sha256, held)
  SELECT owners.org_key, held.playbook_key, held.stream, held.sha256, held.held
  FROM content_references_1 AS held
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = held.playbook_key`;

const ownedContents = SQL`SELECT COUNT(*) AS counted FROM (SELECT DISTINCT owners.org_key, heads.sha256
  FROM recorded_content_heads_by_playbook AS heads
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = heads.playbook_key) AS contents`;

const wholeBefore = SQL`SELECT COUNT(*) AS counted FROM (SELECT DISTINCT owners.org_key, heads.sha256
  FROM recorded_content_heads_by_playbook AS heads
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = heads.playbook_key
  WHERE heads.kept_in = 'ledger' AND ${standing} AND ${wholeChunks}) AS contents`;

const wholeAfter = SQL`SELECT COUNT(*) AS counted FROM recorded_content_heads AS heads
  WHERE heads.kept_in = 'ledger' AND heads.upload_id <> '' AND heads.erased_at IS NULL
    AND heads.chunks = (SELECT COUNT(*) FROM recorded_content_chunks AS kept
      WHERE kept.place_key = heads.place_key AND kept.upload_id = heads.upload_id)`;

const externalPlacesMissed = SQL`SELECT COUNT(*) AS counted
  FROM recorded_content_heads_by_playbook AS heads
  JOIN playbook_keys_of_orgs AS owners ON owners.playbook_key = heads.playbook_key
  WHERE heads.kept_in = 'external' AND ${standing} AND NOT EXISTS (SELECT 1 FROM recorded_content_places AS places
    WHERE places.org_key = owners.org_key AND places.sha256 = heads.sha256 AND places.place_key = heads.playbook_key)`;

async function countOf(execute: StatementExecutor, sql: SQL): Promise<number> {
  const [{ counted }] = Schema.decodeUnknownSync(CountRows)((await execute.query(sql)).rows);
  return Number(counted);
}

function countIn(table: string): SQL {
  return SQL`SELECT COUNT(*) AS counted FROM ${SQL.identifier(table)}`;
}

async function keysIn(execute: StatementExecutor, table: string): Promise<readonly string[]> {
  const { rows } = await execute.query(SQL`SELECT DISTINCT playbook_key FROM ${SQL.identifier(table)}`);
  return Schema.decodeUnknownSync(KeyRows)(rows).map(({ playbook_key }) => playbook_key);
}

function orgKeyOfPlaybookKey(playbookKey: string): string {
  return Option.match(playbookOfStreamPrefix(playbookKey), {
    onNone: () => {
      throw new Error(
        `The content of the store names ${playbookKey}, which is not the key of a playbook, so it cannot be given to an org; the store stays at the layout before`,
      );
    },
    onSome: (playbook) => streamPrefixOfOrg(playbook),
  });
}

async function ownersKept(execute: StatementExecutor, playbookKeys: readonly string[]): Promise<void> {
  await execute.command(SQL`CREATE TABLE playbook_keys_of_orgs (
    playbook_key TEXT NOT NULL PRIMARY KEY,
    org_key TEXT NOT NULL
  )`);
  const keysInAStatement = { mostBoundValues: mostValuesTheLedgerBindsOnSQLite, valuesEach: 2 };
  await inTurn(chunksWithin([...new Set(playbookKeys)], keysInAStatement), (keys) =>
    execute.command(
      SQL`INSERT INTO playbook_keys_of_orgs (playbook_key, org_key) VALUES ${SQL.merge(
        keys.map((key) => SQL`(${key}, ${orgKeyOfPlaybookKey(key)})`),
        ', ',
      )}`,
    ),
  );
}

function requireCarried(found: number, expected: number, what: string): void {
  if (found !== expected) {
    throw new Error(
      `The content of the orgs was carried with ${found} ${what} where the store held ${expected}; the store stays at the layout before`,
    );
  }
}

async function holdsCarried(execute: StatementExecutor, dialect: LayoutDialect): Promise<void> {
  await execute.command(headlessPlacesRecorded);
  await inTurn(holdsOfOrgs(dialect), (statement) => execute.command(statement));
  await execute.command(holdsCopied);
  requireCarried(
    await countOf(execute, countIn('content_references_2')),
    await countOf(execute, countIn('content_references_1')),
    'holds',
  );
  await execute.command(SQL`DROP TABLE content_references_1`);
}

async function contentCarried(execute: StatementExecutor, dialect: LayoutDialect): Promise<void> {
  await execute.command(headsOfPlaybooks);
  await execute.command(chunksOfPlaybooks(dialect));
  await execute.command(SQL`ALTER TABLE recorded_content_chunks RENAME COLUMN playbook_key TO place_key`);
  await execute.command(SQL`CREATE TABLE recorded_content_heads_by_playbook AS SELECT * FROM recorded_content_heads`);
  await execute.command(SQL`DROP TABLE recorded_content_heads`);
  const holding = (await namesFound(execute, dialect.tablesOfTheSchema())).includes('content_references_1');
  const keys = [
    ...(await keysIn(execute, 'recorded_content_heads_by_playbook')),
    ...(holding ? await keysIn(execute, 'content_references_1') : []),
  ];
  await ownersKept(execute, keys);
  await execute.command(headsOfOrgs);
  await execute.command(placesOfOrgs);
  await execute.command(headsMerged);
  await execute.command(externalPlacesRecorded);
  requireCarried(
    await countOf(execute, countIn('recorded_content_heads')),
    await countOf(execute, ownedContents),
    'contents',
  );
  requireCarried(
    await countOf(execute, wholeAfter),
    await countOf(execute, wholeBefore),
    'whole contents in the ledger',
  );
  requireCarried(await countOf(execute, externalPlacesMissed), 0, 'places outside the ledger missed');
  if (holding) {
    await holdsCarried(execute, dialect);
  }
  await execute.command(SQL`DROP TABLE recorded_content_heads_by_playbook`);
  await execute.command(SQL`DROP TABLE playbook_keys_of_orgs`);
}

export const orgContentLayout = 25;

export const orgContentCarried: StepInCode = { inCode: contentCarried };
