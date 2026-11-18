import { messageIdOf, PlaybookContext, streamPrefixOfDefinition } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { publishedDetails } from '../operations/published-details.ts';
import { storedContentOf, type RegisteredDefinition } from '../registry/definition-registry.ts';
import { TriggerSchema } from '../registry/definition-triggers.ts';
import type { ListedDefinition, StoredDefinition } from '../registry/definition.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import type { DefinitionRow, RowAndSave } from './read-model-rows.ts';
import { warningsOfAListEntry } from './remembered-warnings.ts';

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const decodeObject = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

const decodeWarnings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const decodeTriggers = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(TriggerSchema)));

export function savedByOf(
  type: string,
  { definition_id: definition, saved_position: position }: Pick<DefinitionRow, 'definition_id' | 'saved_position'>,
): Effect.Effect<string, never, PlaybookContext> {
  return Effect.map(PlaybookContext, ({ org }) =>
    messageIdOf(`${streamPrefixOfDefinition({ org, definition })}${definitionTypeStreamOf(type)}`, position),
  );
}

function standingOf(row: DefinitionRow) {
  const { paused_by_id: pausedById, paused_by_name: pausedByName } = row;
  return {
    created_at: row.created_at,
    created_by: { id: row.created_by_id, name: row.created_by_name },
    updated_at: row.updated_at,
    ...(row.paused_at === null ? {} : { paused_at: row.paused_at }),
    ...(pausedById === null || pausedByName === null ? {} : { paused_by: { id: pausedById, name: pausedByName } }),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.retired_at === null ? {} : { retired_at: row.retired_at }),
  };
}

export function storedOf({ row, saved }: RowAndSave): RegisteredDefinition {
  return {
    name: row.name,
    definition_id: row.definition_id,
    version: row.version,
    status: row.status,
    ...storedContentOf(saved.data.content),
    ...standingOf(row),
  };
}

function savedWarningsOf({ warnings }: DefinitionRow): readonly string[] {
  return warnings === null ? [] : decodeWarnings(warnings);
}

function schemasOf({ input_schema: input, output_schema: output, triggers }: DefinitionRow) {
  return {
    ...(input === null ? {} : { input_schema: decodeObject(input) }),
    ...(output === null ? {} : { output_schema: decodeObject(output) }),
    ...(triggers === null ? {} : { triggers: decodeTriggers(triggers) }),
  };
}

function detailsOfTheRow({ shape, contributes }: DefinitionRow): Pick<StoredDefinition, 'details'> {
  return {
    details: {
      ...(shape === null ? {} : { shape }),
      ...(contributes === null ? {} : { contributes: decodeJson(contributes) }),
    },
  };
}

export function listedWarningsOf(
  capability: Capability,
  row: DefinitionRow,
  savedBy: string,
): Pick<ListedDefinition, 'warnings'> {
  const warnings = warningsOfAListEntry(capability, savedBy, savedWarningsOf(row));
  return warnings.length === 0 ? {} : { warnings };
}

export function listedOfTheRow(
  capability: Capability,
  row: DefinitionRow,
  savedBy: string,
  goals: boolean,
): ListedDefinition {
  return {
    type: capability.type,
    media_type: capability.mediaType,
    name: row.name,
    definition_id: row.definition_id,
    version: row.version,
    status: row.status,
    ...(row.description === null ? {} : { description: row.description }),
    ...schemasOf(row),
    ...standingOf(row),
    ...listedWarningsOf(capability, row, savedBy),
    ...publishedDetails(detailsOfTheRow(row), goals),
  };
}
