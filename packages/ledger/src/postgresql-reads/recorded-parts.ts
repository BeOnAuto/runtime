import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { Schema } from 'effect';

import type { RecordedPoint } from '../event-store.ts';
import { readMetadataOf, type ExaminationScope, type RecordHead } from '../recorded/recorded-statements.ts';

export type Query = (text: string, values: readonly unknown[]) => Promise<readonly unknown[]>;

export function formattedFor(query: Query): (sql: SQL) => Promise<readonly unknown[]> {
  return (sql) => {
    const { query: text, params } = SQL.format(sql, pgFormatter);
    return query(text, params);
  };
}

export type Bind = (value: unknown) => string;

export const defaultPartition = 'emt:default';

const WriteRows = Schema.Array(Schema.Struct({ id: Schema.String }));

export async function writesOpenElsewhere(query: Query): Promise<readonly string[]> {
  const rows = await query(
    `SELECT backend_xid::text AS id FROM pg_stat_activity
      WHERE backend_xid IS NOT NULL AND datname IS DISTINCT FROM current_database()`,
    [],
  );
  return Schema.decodeUnknownSync(WriteRows)(rows).map(({ id }) => id);
}

export function oldestWriteOfThisDatabase(bind: Bind, elsewhere: readonly string[]): string {
  return `(
  SELECT coalesce(min(running.xid), pg_snapshot_xmax(pg_current_snapshot()))
  FROM pg_snapshot_xip(pg_current_snapshot()) AS running(xid)
  WHERE running.xid::text::bigint % 4294967296 <> ALL(${bind(elsewhere)}::bigint[])
)`;
}

export const PointFields = { transaction: Schema.String, position: Schema.String };

const LineageFields = {
  id: Schema.String,
  metadata: Schema.Unknown,
  correlation: Schema.NullOr(Schema.String),
};

export const HeadFields = {
  ...PointFields,
  ...LineageFields,
  stream: Schema.String,
  version: Schema.Int,
  type: Schema.String,
  recorded: Schema.String,
  size: Schema.Int,
};

export const lineageColumns = `message_id AS id, message_metadata AS metadata,
  message_metadata ->> 'correlationId' AS correlation`;

export function timeOf(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export function binding(): { readonly values: readonly unknown[]; readonly bind: Bind } {
  const values: unknown[] = [];
  return {
    values,
    bind: (value) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

export function direction({ order }: ExaminationScope): string {
  return order === 'asc' ? 'ASC' : 'DESC';
}

function pointAt(bind: Bind, [transaction, position]: RecordedPoint): string {
  return `(${bind(transaction)}::xid8, ${bind(position)}::bigint)`;
}

function beyond(bind: Bind, { order, after, at }: ExaminationScope): string {
  if (after !== undefined) {
    return ` AND (transaction_id, global_position) ${order === 'asc' ? '>' : '<'} ${pointAt(bind, after)}`;
  }
  return at === undefined
    ? ''
    : ` AND (transaction_id, global_position) ${order === 'asc' ? '>=' : '<='} ${pointAt(bind, at)}`;
}

export function bounds(bind: Bind, scope: ExaminationScope): string {
  const { from, to } = scope;
  const after = beyond(bind, scope);
  const since = from === undefined ? '' : ` AND (transaction_id, global_position) >= ${pointAt(bind, from)}`;
  const until = to === undefined ? '' : ` AND (transaction_id, global_position) <= ${pointAt(bind, to)}`;
  return `${after}${since}${until}`;
}

type BelowTheHorizon = (bind: Bind) => string;

export async function horizonOf(query: Query, { order, to }: ExaminationScope): Promise<BelowTheHorizon> {
  if (order !== 'asc' || to !== undefined) {
    return () => '';
  }
  const elsewhere = await writesOpenElsewhere(query);
  return (bind) => ` AND transaction_id < ${oldestWriteOfThisDatabase(bind, elsewhere)}`;
}

export function matchedThroughItsIndex(bind: Bind, key: string, value: string): string {
  return `${key} = ANY(${bind([value])}::text[])`;
}

export function orderedThroughItsIndex(key: string, scope: ExaminationScope): string {
  return `${key} ${direction(scope)}, transaction_id ${direction(scope)}, global_position ${direction(scope)}`;
}

export function ofTypes(bind: Bind, column: string, types: readonly string[] | undefined): string {
  return types === undefined ? 'TRUE' : `${column} = ANY(${bind(types)}::text[])`;
}

interface Sized {
  readonly wanted: string;
  readonly types: string | undefined;
}

export function sizedTypesOf(bind: Bind, { sized }: ExaminationScope): string | undefined {
  return sized === undefined || sized.length === 0 ? undefined : bind(sized);
}

export function sizeOf({ wanted, types }: Sized, { sized }: ExaminationScope, message: string, type: string): string {
  if (sized === undefined) {
    return `CASE WHEN ${wanted} THEN octet_length(${message}.message_data ->> 'json') ELSE 0 END`;
  }
  return types === undefined
    ? '0'
    : `CASE WHEN ${wanted} AND ${type} = ANY(${types}::text[]) THEN octet_length(${message}.message_data ->> 'json') ELSE 0 END`;
}

interface HeadRow {
  readonly transaction: string;
  readonly position: string;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly recorded: string;
  readonly id: string;
  readonly metadata: unknown;
  readonly correlation: string | null;
  readonly size: number;
}

export function headOf({
  transaction,
  position,
  stream,
  version,
  type,
  recorded,
  id,
  metadata,
  correlation,
  size,
}: HeadRow): RecordHead {
  const read = readMetadataOf(metadata);
  return {
    point: [transaction, position],
    id,
    causationId: read.causationId,
    correlationId: correlation,
    stream,
    version,
    globalPosition: Number(position),
    type,
    metadata: read.metadata,
    recordedAt: recorded,
    size,
  };
}
