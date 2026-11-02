import type { ProjectedCondition, ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { isAfter, type ActivityPosition } from '../positions/activity-position.ts';
import { activityName } from '../projections/activity-rows.ts';
import { brokenName } from '../projections/broken-rows.ts';
import { requestsName } from '../projections/request-rows.ts';
import type { ActivityKind, ActivityRow } from './activity-row.ts';

export interface ActivityTable {
  readonly kind: ActivityKind;
  readonly projection: string;
  readonly openColumn: string;
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
  };
}

function brokenOf(playbook: string, key: string, columns: BrokenColumns): ActivityRow {
  return {
    kind: 'broken',
    form: 'broken',
    position: { at: columns.at, playbook, key },
    by: columns.ended_by,
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
  };
}

function newOf(playbook: string, key: string, columns: NewColumns): ActivityRow {
  return {
    kind: 'new',
    form: columns.run_id === null ? 'version' : 'result',
    position: { at: columns.at, playbook, key },
    by: columns.by,
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
  };
}

const requestTable: ActivityTable = {
  kind: 'needs_you',
  projection: requestsName,
  openColumn: 'open',
  rowsOf: (playbook, { key, row }) =>
    Option.toArray(requestColumnsOf(row)).map((columns) => requestOf(playbook, key, columns)),
};

const brokenTable: ActivityTable = {
  kind: 'broken',
  projection: brokenName,
  openColumn: 'open',
  rowsOf: (playbook, { key, row }) =>
    Option.toArray(brokenColumnsOf(row)).map((columns) => brokenOf(playbook, key, columns)),
};

export const newTable: ActivityTable = {
  kind: 'new',
  projection: activityName,
  openColumn: 'listed',
  rowsOf: (playbook, { key, row }) => Option.toArray(newColumnsOf(row)).map((columns) => newOf(playbook, key, columns)),
};

export const activityTables: readonly ActivityTable[] = [requestTable, brokenTable, newTable];

export interface PageBounds {
  readonly cursor: ActivityPosition | undefined;
  readonly since: ActivityPosition | undefined;
}

export function boundsOf({ cursor, since }: PageBounds): readonly ProjectedCondition[] {
  return [
    ...(cursor === undefined ? [] : [{ column: 'at', before: cursor.at }]),
    ...(since === undefined ? [] : [{ column: 'at', after: since.at }]),
  ];
}

export function tiedTimesOf({ cursor, since }: PageBounds): readonly number[] {
  return [cursor?.at, since?.at].filter((at) => at !== undefined);
}

export function withinBounds({ position }: ActivityRow, { cursor, since }: PageBounds): boolean {
  return (cursor === undefined || isAfter(cursor, position)) && (since === undefined || isAfter(position, since));
}
