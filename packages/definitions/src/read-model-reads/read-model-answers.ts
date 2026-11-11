import { messageIdOf, PlaybookContext, streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { storedContentOf, type RegisteredDefinition } from '../registry/definition-registry.ts';
import { TriggerSchema } from '../registry/definition-triggers.ts';
import type { ListedDefinition } from '../registry/definition.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import type { DefinitionRow, RowAndSave } from './read-model-rows.ts';
import { warningsOfAListEntry } from './remembered-warnings.ts';

const decodeObject = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

const decodeWarnings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const decodeTriggers = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(TriggerSchema)));

export function savedByOf(type: string, position: number): Effect.Effect<string, never, PlaybookContext> {
  return Effect.gen(function* () {
    const playbook = yield* PlaybookContext;
    return messageIdOf(`${streamPrefixOfPlaybook(playbook)}${definitionTypeStreamOf(type)}`, position);
  });
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

export function listedOfTheRow(capability: Capability, row: DefinitionRow, savedBy: string): ListedDefinition {
  const warnings = warningsOfAListEntry(capability, savedBy, savedWarningsOf(row));
  return {
    type: capability.type,
    media_type: capability.mediaType,
    name: row.name,
    version: row.version,
    status: row.status,
    ...(row.description === null ? {} : { description: row.description }),
    ...schemasOf(row),
    ...standingOf(row),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(row.shape === null ? {} : { details: { shape: row.shape } }),
  };
}
