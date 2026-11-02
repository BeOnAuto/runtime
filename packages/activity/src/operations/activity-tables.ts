import {
  OrgReader,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { commentKeyOf, ofTheOrg } from '../positions/activity-addresses.ts';
import { isAfter, type ActivityPosition } from '../positions/activity-position.ts';
import { activityName } from '../projections/activity-rows.ts';
import { brokenName } from '../projections/broken-rows.ts';
import { commentsName } from '../projections/comment-rows.ts';
import { requestsName } from '../projections/request-rows.ts';
import type { ActivityKind, ActivityRow } from './activity-row.ts';
import { commentRowsOf } from './comment-activity-rows.ts';

export interface ActivityTable {
  readonly kind: ActivityKind;
  readonly projection: string;
  readonly openColumn: string;
  readonly atColumn: string;
  readonly seenByColumn: string;
  readonly rowKeyOf: (key: string) => string;
  readonly rowsOf: (playbook: string, kept: ProjectedKeyedRow) => readonly ActivityRow[];
}

const TriggerSchema = Schema.NullOr(
  Schema.fromJsonString(Schema.Struct({ kind: Schema.String, reference: Schema.String })),
);

const AnswerSchemaSchema = Schema.NullOr(Schema.String);

const answerSchemaOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const definitionColumns = {
  definition_type: Schema.String,
  definition_name: Schema.String,
  definition_version: Schema.Int,
};

const RequestColumnsSchema = Schema.Struct({
  at: Schema.Int,
  by: Schema.String,
  ...definitionColumns,
  trigger: TriggerSchema,
  message: Schema.String,
  answer_schema: AnswerSchemaSchema,
  waits_on: Schema.String,
  expires_at: Schema.Int,
});

const BrokenColumnsSchema = Schema.Struct({
  at: Schema.Int,
  status: Schema.Literals(['failed', 'rejected']),
  definition_type: Schema.String,
  definition_name: Schema.String,
  version: Schema.Int,
  run_id: Schema.String,
  detail: Schema.NullOr(Schema.String),
  ended_by: Schema.String,
  trigger: TriggerSchema,
});

const NewColumnsSchema = Schema.Struct({
  at: Schema.Int,
  by: Schema.String,
  change: Schema.NullOr(Schema.Literals(['created', 'updated'])),
  ...definitionColumns,
  run_id: Schema.NullOr(Schema.String),
  trigger: TriggerSchema,
  output_shape: Schema.NullOr(Schema.String),
});

const requestColumnsOf = Schema.decodeUnknownOption(RequestColumnsSchema);

const brokenColumnsOf = Schema.decodeUnknownOption(BrokenColumnsSchema);

const newColumnsOf = Schema.decodeUnknownOption(NewColumnsSchema);

type RequestColumns = typeof RequestColumnsSchema.Type;

type BrokenColumns = typeof BrokenColumnsSchema.Type;

type NewColumns = typeof NewColumnsSchema.Type;

function definitionOf({
  definition_type: type,
  definition_name: name,
  definition_version: version,
}: NewColumns | RequestColumns) {
  return { type, name, version };
}

function requestOf(playbook: string, key: string, columns: RequestColumns): ActivityRow {
  return {
    kind: 'needs_you',
    form: 'request',
    position: { at: columns.at, playbook, key },
    by: columns.by,
    by_name: null,
    change: null,
    trigger: columns.trigger,
    definition: definitionOf(columns),
    run_id: key,
    output_shape: null,
    message: columns.message,
    answer_schema: Option.getOrNull(answerSchemaOf(columns.answer_schema)),
    detail: null,
    status: null,
    waits_on: columns.waits_on,
    expires_at: columns.expires_at,
    about: null,
  };
}

function brokenOf(playbook: string, key: string, columns: BrokenColumns): ActivityRow {
  return {
    kind: 'broken',
    form: 'broken',
    position: { at: columns.at, playbook, key },
    by: columns.ended_by,
    by_name: null,
    change: null,
    trigger: columns.trigger,
    definition: { type: columns.definition_type, name: columns.definition_name, version: columns.version },
    run_id: columns.run_id,
    output_shape: null,
    message: null,
    answer_schema: null,
    detail: columns.detail,
    status: columns.status,
    waits_on: null,
    expires_at: null,
    about: null,
  };
}

function newOf(playbook: string, key: string, columns: NewColumns): ActivityRow {
  return {
    kind: 'new',
    form: columns.run_id === null ? 'version' : 'result',
    position: { at: columns.at, playbook, key },
    by: columns.by,
    by_name: null,
    change: columns.change,
    trigger: columns.trigger,
    definition: definitionOf(columns),
    run_id: columns.run_id,
    output_shape: columns.output_shape,
    message: null,
    answer_schema: null,
    detail: null,
    status: null,
    waits_on: null,
    expires_at: null,
    about: null,
  };
}

function asKept(key: string): string {
  return key;
}

const requestTable: ActivityTable = {
  kind: 'needs_you',
  projection: requestsName,
  openColumn: 'open',
  atColumn: 'at',
  seenByColumn: 'by',
  rowKeyOf: asKept,
  rowsOf: (playbook, { key, row }) =>
    Option.toArray(requestColumnsOf(row)).map((columns) => requestOf(playbook, key, columns)),
};

const brokenTable: ActivityTable = {
  kind: 'broken',
  projection: brokenName,
  openColumn: 'open',
  atColumn: 'at',
  seenByColumn: 'ended_by',
  rowKeyOf: asKept,
  rowsOf: (playbook, { key, row }) =>
    Option.toArray(brokenColumnsOf(row)).map((columns) => brokenOf(playbook, key, columns)),
};

export const newTable: ActivityTable = {
  kind: 'new',
  projection: activityName,
  openColumn: 'listed',
  atColumn: 'at',
  seenByColumn: 'by',
  rowKeyOf: asKept,
  rowsOf: (playbook, { key, row }) => Option.toArray(newColumnsOf(row)).map((columns) => newOf(playbook, key, columns)),
};

export const commentTable: ActivityTable = {
  kind: 'comment',
  projection: commentsName,
  openColumn: 'open',
  atColumn: 'listed_at',
  seenByColumn: 'listed_by',
  rowKeyOf: (key) => key.slice(commentKeyOf('').length),
  rowsOf: commentRowsOf,
};

export const activityTables: readonly ActivityTable[] = [requestTable, brokenTable, newTable, commentTable];

export function rowsOwnedBy(owner: string, projection: string, query: ProjectedRowsQuery) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    return yield* owner === ofTheOrg
      ? reader.readProjectedRows(projection, query)
      : reader.readPlaybookRows(owner, projection, query);
  });
}

export function rowsCountedOf(owner: string, projection: string, where: readonly ProjectedCondition[]) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    return yield* owner === ofTheOrg
      ? reader.countProjectedRows(projection, where)
      : reader.countPlaybookRows(owner, projection, where);
  });
}

export interface PageBounds {
  readonly cursor: ActivityPosition | undefined;
  readonly since: ActivityPosition | undefined;
}

export function boundsOf({ cursor, since }: PageBounds, { atColumn }: ActivityTable): readonly ProjectedCondition[] {
  return [
    ...(cursor === undefined ? [] : [{ column: atColumn, before: cursor.at }]),
    ...(since === undefined ? [] : [{ column: atColumn, after: since.at }]),
  ];
}

export function tiedTimesOf({ cursor, since }: PageBounds): readonly number[] {
  return [cursor?.at, since?.at].filter((at) => at !== undefined);
}

export function withinBounds({ position }: ActivityRow, { cursor, since }: PageBounds): boolean {
  return (cursor === undefined || isAfter(cursor, position)) && (since === undefined || isAfter(position, since));
}
