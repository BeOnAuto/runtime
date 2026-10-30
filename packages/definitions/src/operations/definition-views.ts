import type { InvalidInput, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { ListedDefinition, Definition, StoredDefinition } from '../registry/definition.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { rejectionOfSource, type Rejection } from './issue-pointers.ts';
import { savedDefinitions } from './saved-definitions.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredDefinition) => name);

function publishedDetails({ details }: StoredDefinition): Pick<Definition, 'details'> {
  const shape = shapeNameIn(details);
  return shape === undefined ? {} : { details: { shape } };
}

export function definitionOf({ type, mediaType }: Capability, stored: StoredDefinition): Definition {
  return {
    type,
    media_type: mediaType,
    ...Struct.omit(stored, ['details', 'stripped']),
    ...publishedDetails(stored),
  };
}

export function listedDefinitionOf(capability: Capability, stored: StoredDefinition): ListedDefinition {
  return Struct.omit(definitionOf(capability, stored), ['source', 'overview']);
}

export interface WrittenDefinition {
  readonly source: string;
  readonly overview?: string;
}

function writtenContentOf({ source, overview }: WrittenDefinition): Pick<DefinitionContent, 'source' | 'overview'> {
  return overview === undefined ? { source } : { source, overview };
}

function contentFrom(
  written: WrittenDefinition,
  { description, inputSchema, outputSchema, warnings = [], triggers = [], details }: DefinitionSummary,
  stripped: StrippedForms,
): DefinitionContent {
  return {
    ...writtenContentOf(written),
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { input_schema: inputSchema }),
    ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(triggers.length === 0 ? {} : { triggers }),
    ...(details === undefined ? {} : { details }),
    ...(Object.keys(stripped).length === 0 ? {} : { stripped }),
  };
}

function refusedSource(rejection: Rejection): Effect.Effect<never, InvalidInput> {
  return Effect.fail(rejectionOfSource(rejection));
}

export function contentOf(
  capability: Capability,
  written: WrittenDefinition,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookReader> {
  return Effect.gen(function* () {
    const { summary, check } = yield* capability.prepare(written.source);
    const stripped = yield* check(yield* savedDefinitions);
    return contentFrom(written, summary, stripped);
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}
