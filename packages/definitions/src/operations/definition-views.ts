import type { InvalidInput, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import { encodedOverview, type Overview } from '../overview/overview.ts';
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

function publishedOf({ type, mediaType }: Capability, stored: StoredDefinition): Omit<Definition, 'overview'> {
  return {
    type,
    media_type: mediaType,
    ...Struct.omit(stored, ['details', 'stripped', 'overview']),
    ...publishedDetails(stored),
  };
}

export function definitionOf(capability: Capability, stored: StoredDefinition, overview: string): Definition {
  return { ...publishedOf(capability, stored), overview };
}

export function listedDefinitionOf(capability: Capability, stored: StoredDefinition): ListedDefinition {
  return Struct.omit(publishedOf(capability, stored), ['source']);
}

function contentFrom(
  source: string,
  { description, inputSchema, outputSchema, warnings = [], triggers = [], details }: DefinitionSummary,
  stripped: StrippedForms,
  overview: Overview,
): DefinitionContent {
  return {
    source,
    overview: encodedOverview(overview),
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
  name: string,
  source: string,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookReader> {
  return Effect.gen(function* () {
    const { summary, check, overview } = yield* capability.prepare(source);
    const stripped = yield* check(yield* savedDefinitions);
    return contentFrom(source, summary, stripped, overview(name));
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}
