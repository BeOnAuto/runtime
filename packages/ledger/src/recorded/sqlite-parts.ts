import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { RecordedPoint } from '../event-store.ts';
import { readMetadataOf } from './recorded-messages.ts';
import type { ExaminationScope, Keys, RecordHead } from './recorded-statements.ts';

export const defaultPartition = 'emt:default';

const Lineage = {
  id: Schema.String,
  metadata: Schema.fromJsonString(Schema.Unknown),
  correlation: Schema.NullOr(Schema.String),
};

export const HeadFields = {
  position: Schema.Int,
  stream: Schema.String,
  version: Schema.Int,
  type: Schema.String,
  recorded: Schema.String,
  ...Lineage,
};

export const ExaminedRecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, wanted: Schema.Int, size: Schema.Int, examined: Schema.Int }),
);

export const PositionRows = Schema.Array(Schema.Struct({ position: Schema.Int }));

export const DataRows = Schema.Array(
  Schema.Struct({ position: Schema.Int, data: Schema.fromJsonString(Schema.Unknown) }),
);

export const RecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, size: Schema.Int, data: Schema.fromJsonString(Schema.Unknown) }),
);

interface HeadRow {
  readonly position: number;
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
    point: [String(position)],
    id,
    causationId: read.causationId,
    correlationId: correlation,
    stream,
    version,
    globalPosition: position,
    type,
    metadata: read.metadata,
    recordedAt: `${recorded.replace(' ', 'T')}.000Z`,
    size,
  };
}

export function secondOf(since: string): string {
  return new Date(since).toISOString().slice(0, 19).replace('T', ' ');
}

export function positionOf(point: RecordedPoint): number {
  return Number(point[0]);
}

export function direction({ order }: ExaminationScope): SQL {
  return order === 'asc' ? SQL`ASC` : SQL`DESC`;
}

function beyond({ order, after, at }: ExaminationScope): SQL {
  if (after !== undefined) {
    return SQL` AND global_position ${SQL.plain(order === 'asc' ? '>' : '<')} ${positionOf(after)}`;
  }
  return at === undefined
    ? SQL.EMPTY
    : SQL` AND global_position ${SQL.plain(order === 'asc' ? '>=' : '<=')} ${positionOf(at)}`;
}

export function bounds(scope: ExaminationScope): SQL {
  return SQL.concat(
    beyond(scope),
    scope.from === undefined ? SQL.EMPTY : SQL` AND global_position >= ${positionOf(scope.from)}`,
    scope.to === undefined ? SQL.EMPTY : SQL` AND global_position <= ${positionOf(scope.to)}`,
  );
}

export function listed(values: readonly string[]): SQL {
  return SQL`(SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

type Matched = (each: SQL) => SQL;

export function eachWalkedInTurn(each: Keys, walk: Matched): SQL {
  return SQL`global_position IN (
      SELECT walked.global_position FROM json_each(${JSON.stringify(each)}) AS keyed
      JOIN emt_messages AS walked ON walked.global_position IN (${walk(SQL`keyed.value`)})
    )`;
}

export function oneOrEachInTurn(each: Keys, matched: Matched, walk: Matched): SQL {
  const [only, ...more] = each;
  return more.length === 0 ? matched(SQL`${only}`) : eachWalkedInTurn(each, (one) => walk(matched(one)));
}

export function walkedInTheOrderOf(scope: ExaminationScope): Matched {
  return (matched) => SQL`SELECT global_position FROM emt_messages
    WHERE ${matched}${keptOf(scope)}
    ORDER BY global_position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function keptOf(scope: ExaminationScope): SQL {
  return SQL` AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}`;
}

export function ofTypes(column: string, types: readonly string[] | undefined): SQL {
  return types === undefined
    ? SQL`1`
    : SQL`${SQL.plain(column)} IN (SELECT value FROM json_each(${JSON.stringify(types)}))`;
}

export function sizeOf({ sized }: ExaminationScope, wanted: SQL, type: string, size: string): SQL {
  if (sized === undefined) {
    return SQL`CASE WHEN ${wanted} THEN ${SQL.plain(size)} ELSE 0 END`;
  }
  return sized.length === 0
    ? SQL`0`
    : SQL`CASE WHEN ${wanted} AND ${ofTypes(type, sized)} THEN ${SQL.plain(size)} ELSE 0 END`;
}
