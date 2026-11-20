import {
  definitionOfStreamPrefix,
  PlaybookContext,
  PlaybookReader,
  type BoundProjectionReader,
  type PlaybookAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type StreamReader,
} from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect, Option, Schema } from 'effect';

import { keyOfTheDefinition } from '../read-model/definition-rows.ts';
import { keyOfTheVersion } from '../read-model/version-rows.ts';
import { DefinitionEventSchema, isDefinitionSaved, type DefinitionSaved } from '../registry/definition-events.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { ReadModelRefused } from './read-model-refused.ts';

const rowsInAPage = 100;

const DefinitionRowSchema = Schema.Struct({
  definition_type: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  status: Schema.Literals(['active', 'paused', 'retired']),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
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

export type DefinitionRow = Omit<typeof DefinitionRowSchema.Type, 'contributes' | 'title'> & {
  readonly definition_id: string;
  readonly contributes: string | null;
  readonly title: string | null;
};

const VersionRowSchema = Schema.Struct({
  definition_type: Schema.String,
  version: Schema.Number,
  position: Schema.Number,
  put_in_place_by: Schema.String,
});

type VersionRow = typeof VersionRowSchema.Type;

const decodeDefinitionRow = Schema.decodeUnknownSync(DefinitionRowSchema);

function definitionRowsIn({ definition, row }: ProjectedKeyedRow): readonly DefinitionRow[] {
  if (definition === undefined) {
    return [];
  }
  const decoded = decodeDefinitionRow(row);
  return [
    { ...decoded, definition_id: definition, contributes: decoded.contributes ?? null, title: decoded.title ?? null },
  ];
}

const decodeVersionRow = Schema.decodeUnknownSync(VersionRowSchema);

export interface ReadModelReader
  extends Pick<BoundProjectionReader, 'readProjectedRows'>, Pick<PlaybookReader['Service'], 'holderOfName'> {
  readonly ofDefinition: (definition: string) => Pick<StreamReader, 'factAt'>;
  readonly playbook: PlaybookAddress;
}

export type Read<A> = Effect.Effect<A, ReadModelRefused>;

type ReadInThePlaybook<A> = Effect.Effect<A, ReadModelRefused, PlaybookReader | PlaybookContext>;

export function inThePlaybookOf<A, E>(
  read: (reader: ReadModelReader) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const playbook = yield* PlaybookContext;
    const { ofDefinition, readProjectedRows, holderOfName } = yield* PlaybookReader;
    return yield* read({ ofDefinition, readProjectedRows, holderOfName, playbook });
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

export function everyRowOf(
  reader: Pick<ReadModelReader, 'readProjectedRows'>,
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

function definitionOfHolder(held: HeldName | undefined): string | undefined {
  return held === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(definitionOfStreamPrefix(held.definitionKey), ({ definition }) => definition));
}

function holderOf(reader: ReadModelReader, type: string, name: string): Read<string | undefined> {
  return Effect.map(reader.holderOfName(type, name), definitionOfHolder);
}

export function rowOfTheDefinition(
  reader: ReadModelReader,
  type: string,
  definition: string,
): Read<DefinitionRow | undefined> {
  return Effect.map(
    rowsOf(reader, 'definitions', [{ column: 'row_key', equals: keyOfTheDefinition(type, definition) }], 1),
    (rows) => rows.flatMap((found) => definitionRowsIn(found)).at(0),
  );
}

function definitionRowOf(reader: ReadModelReader, type: string, name: string): Read<DefinitionRow | undefined> {
  return Effect.flatMap(holderOf(reader, type, name), (definition) =>
    definition === undefined ? Effect.undefined : rowOfTheDefinition(reader, type, definition),
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

function versionRowIn(
  reader: ReadModelReader,
  type: string,
  definition: string,
  version: number,
): Read<VersionInItsDefinition | undefined> {
  const key = keyOfTheVersion(keyOfTheDefinition(type, definition), version);
  return Effect.map(rowsOf(reader, 'definition_versions', [{ column: 'row_key', equals: key }], 1), (rows) =>
    rows
      .flatMap((found) => (found.definition === definition ? [{ row: decodeVersionRow(found.row), definition }] : []))
      .at(0),
  );
}

function versionRowOf(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Read<VersionInItsDefinition | undefined> {
  return Effect.flatMap(holderOf(reader, type, name), (definition) =>
    definition === undefined ? Effect.undefined : versionRowIn(reader, type, definition, version),
  );
}

export const pointerDisagrees = new ReadModelRefused({ because: 'pointer_disagrees' });

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
  { version }: Pick<DefinitionRow, 'version'>,
  fact: DefinitionSaved | undefined,
): fact is DefinitionSaved {
  return fact?.context.definitionVersion === version;
}

export interface RowAndSave {
  readonly row: DefinitionRow;
  readonly saved: DefinitionSaved;
}

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
