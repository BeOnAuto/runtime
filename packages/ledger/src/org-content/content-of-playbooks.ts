import { sha256Of, type PlaybookAddress } from '@on.auto/content';
import { Schema } from 'effect';

import { carryingTo } from '../layout/carrying-on-behaviour.ts';
import { structureIn } from '../structure/database-structure-behaviour.ts';
import { contentTablesOfPlaybooks } from '../testing/content-tables-of-playbooks.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { orgContentLayout } from './org-content-step.ts';

export const carryingToIt = carryingTo(orgContentLayout);

export const note = '{"note":"kept by two playbooks of one org"}';

export const digest = sha256Of(note);

export const [alpha, beta, gamma] = ['playbook/acme/alpha/', 'playbook/acme/beta/', 'playbook/globex/gamma/'];

export const acmesOther: PlaybookAddress = { org: 'acme', playbook: 'one that never kept it' };

export const globexsOther: PlaybookAddress = { org: 'globex', playbook: 'one that never kept it' };

export const [earlier, later, elsewhere] = [
  '00000000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-000000000002',
  '00000000-0000-7000-8000-000000000003',
];

const HeadRows = Schema.Array(
  Schema.Struct({
    org_key: Schema.String,
    place_key: Schema.String,
    upload_id: Schema.String,
    kept_at: Schema.Number,
    kept_in: Schema.String,
    removing_since: Schema.NullOr(Schema.Number),
    expires_at: Schema.NullOr(Schema.Number),
    erased_at: Schema.NullOr(Schema.Number),
  }),
);

type HeadRow = (typeof HeadRows.Type)[number];

const Counted = Schema.Tuple([Schema.Struct({ counted: Schema.Number })]);

const PlaceRows = Schema.Array(
  Schema.Struct({ org_key: Schema.String, sha256: Schema.String, place_key: Schema.String }),
);

interface Head {
  readonly key: string;
  readonly upload: string;
  readonly keptAt: number;
  readonly keptIn?: string;
  readonly removingSince?: number;
  readonly expiresAt?: number;
  readonly erasedAt?: number;
}

function valueOf(value: number | undefined): string {
  return value === undefined ? 'NULL' : String(value);
}

export function headKept(entry: LedgerEntry, database: string, head: Head): Promise<unknown> {
  const { key, upload, keptAt, keptIn = 'ledger', removingSince, expiresAt, erasedAt } = head;
  return entry.queried(
    database,
    `INSERT INTO recorded_content_heads
      (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_at, kept_in, removing_since, expires_at, erased_at)
      VALUES ('${key}', '${digest}', '${upload}', ${String(Buffer.byteLength(note))}, 1, 'application/json',
        ${String(keptAt)}, '${keptIn}', ${valueOf(removingSince)}, ${valueOf(expiresAt)}, ${valueOf(erasedAt)})`,
  );
}

function bytesOf(entry: LedgerEntry, text: string): string {
  const hex = Buffer.from(text).toString('hex');
  return entry.layout.dialect === 'postgresql' ? `decode('${hex}', 'hex')` : `unhex('${hex}')`;
}

export function chunkKept(entry: LedgerEntry, database: string, key: string, upload: string): Promise<unknown> {
  return entry.queried(
    database,
    `INSERT INTO recorded_content_chunks (playbook_key, upload_id, chunk, data)
      VALUES ('${key}', '${upload}', 0, ${bytesOf(entry, note)})`,
  );
}

export function layoutBeforeSet(entry: LedgerEntry, database: string): Promise<unknown> {
  return entry.queried(database, `UPDATE ledger_layout SET layout = ${String(orgContentLayout - 1)}`);
}

export async function aStoreOfPlaybooksContent(
  entry: LedgerEntry,
): Promise<{ readonly database: string; readonly made: unknown }> {
  const database = await entry.aDatabase();
  await aLedger(entry, database);
  const made = await structureIn(entry, database);
  await contentTablesOfPlaybooks(entry, database);
  await layoutBeforeSet(entry, database);
  return { database, made };
}

export async function headsIn(entry: LedgerEntry, database: string): Promise<readonly HeadRow[]> {
  return Schema.decodeUnknownSync(HeadRows)(
    await entry.queried(
      database,
      `SELECT org_key, place_key, upload_id, CAST(kept_at AS DOUBLE PRECISION) AS kept_at, kept_in,
        CAST(removing_since AS DOUBLE PRECISION) AS removing_since, CAST(expires_at AS DOUBLE PRECISION) AS expires_at,
        CAST(erased_at AS DOUBLE PRECISION) AS erased_at
      FROM recorded_content_heads ORDER BY org_key`,
    ),
  );
}

export function aHead(head: Partial<HeadRow>): HeadRow {
  return {
    org_key: '',
    place_key: '',
    upload_id: '',
    kept_at: 0,
    kept_in: 'ledger',
    removing_since: null,
    expires_at: null,
    erased_at: null,
    ...head,
  };
}

export async function countedIn(entry: LedgerEntry, database: string, table: string): Promise<number> {
  const [{ counted }] = Schema.decodeUnknownSync(Counted)(
    await entry.queried(database, `SELECT CAST(count(*) AS INTEGER) AS counted FROM ${table}`),
  );
  return counted;
}

export async function placesIn(entry: LedgerEntry, database: string): Promise<typeof PlaceRows.Type> {
  return Schema.decodeUnknownSync(PlaceRows)(
    await entry.queried(database, 'SELECT org_key, sha256, place_key FROM recorded_content_places ORDER BY place_key'),
  );
}
