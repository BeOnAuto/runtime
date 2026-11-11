import {
  PlaybookContext,
  PlaybookReader,
  type BoundProjectionReader,
  type PlaybookAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type StreamReader,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { DefinitionEventSchema, isDefinitionSaved, type DefinitionSaved } from '../registry/definition-events.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { oncePerOpening, refusedWhenItsChecksFailed, type ReadModelRefused } from './read-model-refused.ts';

const rowsInAPage = 100;

const DefinitionRowSchema = Schema.Struct({
  definition_type: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  status: Schema.Literals(['active', 'paused', 'retired']),
  description: Schema.NullOr(Schema.String),
  input_schema: Schema.NullOr(Schema.String),
  output_schema: Schema.NullOr(Schema.String),
  warnings: Schema.NullOr(Schema.String),
  shape: Schema.NullOr(Schema.String),
  triggers: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  created_by_id: Schema.String,
  created_by_name: Schema.String,
  updated_at: Schema.String,
  paused_at: Schema.NullOr(Schema.String),
  paused_by_id: Schema.NullOr(Schema.String),
  paused_by_name: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  retired_at: Schema.NullOr(Schema.String),
  saved_position: Schema.Number,
});

export type DefinitionRow = typeof DefinitionRowSchema.Type;

const VersionRowSchema = Schema.Struct({
  definition_type: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  position: Schema.Number,
  put_in_place_by: Schema.String,
});

type VersionRow = typeof VersionRowSchema.Type;

const ReferenceRowSchema = Schema.Struct({
  user_type: Schema.String,
  user_name: Schema.String,
  used_type: Schema.String,
  used_name: Schema.String,
  relation: Schema.Literals(['calls', 'reads']),
  places: Schema.String,
});

export type ReferenceRow = typeof ReferenceRowSchema.Type;

const decodeDefinitionRow = Schema.decodeUnknownSync(DefinitionRowSchema);

const decodeVersionRow = Schema.decodeUnknownSync(VersionRowSchema);

const decodeReferenceRow = Schema.decodeUnknownSync(ReferenceRowSchema);

export interface ReadModelReader
  extends Pick<StreamReader, 'factAt'>, Pick<BoundProjectionReader, 'readProjectedRows' | 'resetStreamProjection'> {
  readonly playbook: PlaybookAddress;
}

type Read<A> = Effect.Effect<A, ReadModelRefused>;

type ReadInThePlaybook<A> = Effect.Effect<A, ReadModelRefused, PlaybookReader | PlaybookContext>;

export function inThePlaybookOf<A, E>(
  read: (reader: ReadModelReader) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const playbook = yield* PlaybookContext;
    const { factAt, readProjectedRows, resetStreamProjection } = yield* PlaybookReader;
    return yield* read({ factAt, readProjectedRows, resetStreamProjection, playbook });
  });
}

function rowsOf(
  reader: ReadModelReader,
  table: string,
  where: readonly ProjectedCondition[],
  limit: number,
): Read<readonly ProjectedKeyedRow[]> {
  return refusedWhenItsChecksFailed(reader.readProjectedRows(table, { where, orderBy: [], order: 'asc', limit }));
}

function everyRowOf(
  reader: ReadModelReader,
  table: string,
  where: readonly ProjectedCondition[],
  after: readonly (string | number)[] = [],
): Read<readonly ProjectedKeyedRow[]> {
  const page = refusedWhenItsChecksFailed(
    reader.readProjectedRows(table, {
      where,
      orderBy: [],
      order: 'asc',
      limit: rowsInAPage,
      ...(after.length === 0 ? {} : { after }),
    }),
  );
  return Effect.flatMap(page, (rows) => {
    const last = rows.at(-1);
    return last === undefined || rows.length < rowsInAPage
      ? Effect.succeed(rows)
      : Effect.map(
          everyRowOf(reader, table, where, [last.key, ...(last.child === undefined ? [] : [last.child])]),
          (rest) => [...rows, ...rest],
        );
  });
}

function definitionRowOf(reader: ReadModelReader, type: string, name: string): Read<DefinitionRow | undefined> {
  return Effect.map(rowsOf(reader, 'definitions', [{ column: 'row_key', equals: `${type}/${name}` }], 1), ([found]) =>
    found === undefined ? undefined : decodeDefinitionRow(found.row),
  );
}

export function definitionRowsOfType(type: string): ReadInThePlaybook<readonly DefinitionRow[]> {
  return inThePlaybookOf((reader) =>
    Effect.map(everyRowOf(reader, 'definitions', [{ column: 'definition_type', equals: type }]), (rows) =>
      rows.map(({ row }) => decodeDefinitionRow(row)),
    ),
  );
}

function versionRowOf(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionRow | undefined> {
  return Effect.map(
    rowsOf(reader, 'definition_versions', [{ column: 'row_key', equals: `${type}/${name}/${version}` }], 1),
    ([found]) => (found === undefined ? undefined : decodeVersionRow(found.row)),
  );
}

export function referencesTo(type: string, name: string): ReadInThePlaybook<readonly ReferenceRow[]> {
  return inThePlaybookOf((reader) =>
    Effect.map(
      everyRowOf(reader, 'definition_references', [
        { column: 'used_type', equals: type },
        { column: 'used_name', equals: name },
      ]),
      (rows) => rows.map(({ row }) => decodeReferenceRow(row)),
    ),
  );
}

function savedAt(reader: ReadModelReader, type: string, position: number): Read<DefinitionSaved | undefined> {
  return Effect.map(reader.factAt(definitionTypeStreamOf(type), position, DefinitionEventSchema), (fact) =>
    fact !== undefined && isDefinitionSaved(fact) ? fact : undefined,
  );
}

function isTheSave(
  { name, version }: Pick<DefinitionRow, 'name' | 'version'>,
  fact: DefinitionSaved | undefined,
): fact is DefinitionSaved {
  return fact?.context.definitionName === name && fact.context.definitionVersion === version;
}

export interface RowAndSave {
  readonly row: DefinitionRow;
  readonly saved: DefinitionSaved;
}

function rowAndSaveOnce(
  reader: ReadModelReader,
  type: string,
  name: string,
): Read<RowAndSave | undefined | 'disagrees'> {
  return Effect.flatMap(definitionRowOf(reader, type, name), (row) =>
    row === undefined
      ? Effect.undefined
      : Effect.map(savedAt(reader, type, row.saved_position), (saved): RowAndSave | 'disagrees' =>
          isTheSave(row, saved) ? { row, saved } : 'disagrees',
        ),
  );
}

function pointerResetOf(reader: ReadModelReader, type: string) {
  return { playbook: reader.playbook, type, reset: reader.resetStreamProjection('definitions') };
}

export function rowAndSaveOf(type: string, name: string): ReadInThePlaybook<RowAndSave | undefined> {
  return inThePlaybookOf((reader) => oncePerOpening(pointerResetOf(reader, type), rowAndSaveOnce(reader, type, name)));
}

export interface VersionAndSave {
  readonly row: VersionRow;
  readonly saved: DefinitionSaved;
}

function versionAndSaveOnce(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionAndSave | undefined | 'disagrees'> {
  return Effect.flatMap(versionRowOf(reader, type, name, version), (row) =>
    row === undefined
      ? Effect.undefined
      : Effect.map(savedAt(reader, type, row.position), (saved): VersionAndSave | 'disagrees' =>
          isTheSave(row, saved) ? { row, saved } : 'disagrees',
        ),
  );
}

export function versionAndSaveIn(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionAndSave | undefined> {
  return oncePerOpening(pointerResetOf(reader, type), versionAndSaveOnce(reader, type, name, version));
}
