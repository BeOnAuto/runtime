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
import { ReadModelRefused } from './read-model-refused.ts';

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
  contributes: Schema.optionalKey(Schema.NullOr(Schema.String)),
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

export type DefinitionRow = Omit<typeof DefinitionRowSchema.Type, 'contributes'> & {
  readonly definition_id: string;
  readonly contributes: string | null;
};

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

function definitionRowsIn({ definition, row }: ProjectedKeyedRow): readonly DefinitionRow[] {
  if (definition === undefined) {
    return [];
  }
  const decoded = decodeDefinitionRow(row);
  return [{ ...decoded, definition_id: definition, contributes: decoded.contributes ?? null }];
}

const decodeVersionRow = Schema.decodeUnknownSync(VersionRowSchema);

const decodeReferenceRow = Schema.decodeUnknownSync(ReferenceRowSchema);

export interface ReadModelReader extends Pick<BoundProjectionReader, 'readProjectedRows'> {
  readonly ofDefinition: (definition: string) => Pick<StreamReader, 'factAt'>;
  readonly playbook: PlaybookAddress;
}

type Read<A> = Effect.Effect<A, ReadModelRefused>;

type ReadInThePlaybook<A> = Effect.Effect<A, ReadModelRefused, PlaybookReader | PlaybookContext>;

export function inThePlaybookOf<A, E>(
  read: (reader: ReadModelReader) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const playbook = yield* PlaybookContext;
    const { ofDefinition, readProjectedRows } = yield* PlaybookReader;
    return yield* read({ ofDefinition, readProjectedRows, playbook });
  });
}

function rowsOf(
  reader: ReadModelReader,
  table: string,
  where: readonly ProjectedCondition[],
  limit: number,
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  return reader.readProjectedRows(table, { where, orderBy: [], order: 'asc', limit });
}

function everyRowOf(
  reader: ReadModelReader,
  table: string,
  where: readonly ProjectedCondition[],
  after: readonly (string | number)[] = [],
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  const page = reader.readProjectedRows(table, {
    where,
    orderBy: [],
    order: 'asc',
    limit: rowsInAPage,
    ...(after.length === 0 ? {} : { after }),
  });
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
  return Effect.map(rowsOf(reader, 'definitions', [{ column: 'row_key', equals: `${type}/${name}` }], 1), (rows) =>
    rows.flatMap((found) => definitionRowsIn(found)).at(0),
  );
}

export function definitionRowsOfType(type: string): ReadInThePlaybook<readonly DefinitionRow[]> {
  return inThePlaybookOf((reader) =>
    Effect.map(everyRowOf(reader, 'definitions', [{ column: 'definition_type', equals: type }]), (rows) =>
      rows.flatMap((found) => definitionRowsIn(found)),
    ),
  );
}

interface VersionInItsDefinition {
  readonly row: VersionRow;
  readonly definition: string;
}

function versionRowOf(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionInItsDefinition | undefined> {
  return Effect.map(
    rowsOf(reader, 'definition_versions', [{ column: 'row_key', equals: `${type}/${name}/${version}` }], 1),
    (rows) =>
      rows
        .flatMap(({ row, definition }) =>
          definition === undefined ? [] : [{ row: decodeVersionRow(row), definition }],
        )
        .at(0),
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

function savedAt(
  reader: ReadModelReader,
  type: string,
  definition: string,
  position: number,
): Read<DefinitionSaved | undefined> {
  return Effect.map(
    reader.ofDefinition(definition).factAt(definitionTypeStreamOf(type), position, DefinitionEventSchema),
    (fact) => (fact !== undefined && isDefinitionSaved(fact) ? fact : undefined),
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

const pointerDisagrees = new ReadModelRefused({ because: 'pointer_disagrees' });

export function rowAndSaveOf(type: string, name: string): ReadInThePlaybook<RowAndSave | undefined> {
  return inThePlaybookOf((reader) =>
    Effect.flatMap(definitionRowOf(reader, type, name), (row) =>
      row === undefined
        ? Effect.undefined
        : Effect.flatMap(savedAt(reader, type, row.definition_id, row.saved_position), (saved) =>
            isTheSave(row, saved) ? Effect.succeed({ row, saved }) : Effect.fail(pointerDisagrees),
          ),
    ),
  );
}

export interface VersionAndSave {
  readonly definition: string;
  readonly row: VersionRow;
  readonly saved: DefinitionSaved;
}

export function versionAndSaveIn(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionAndSave | undefined> {
  return Effect.flatMap(versionRowOf(reader, type, name, version), (found) =>
    found === undefined
      ? Effect.undefined
      : Effect.flatMap(savedAt(reader, type, found.definition, found.row.position), (saved) =>
          isTheSave(found.row, saved) ? Effect.succeed({ ...found, saved }) : Effect.fail(pointerDisagrees),
        ),
  );
}
