import { InvalidInput, PlaybookContext, type Unavailable } from '@on.auto/operations';
import { articled, capitalized } from '@on.auto/phrasing';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import {
  isPlaybookFunctionType,
  type ListedDefinition,
  type Definition,
  type StoredDefinition,
} from '../registry/definition.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { rejectionOfSource, type Rejection } from './issue-pointers.ts';

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
  return Struct.omit(definitionOf(capability, stored), ['source', 'overview', 'diagram']);
}

export interface WrittenDefinition {
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
}

function writtenContentOf({
  source,
  overview,
  diagram,
}: WrittenDefinition): Pick<DefinitionContent, 'source' | 'overview' | 'diagram'> {
  return {
    source,
    ...(overview === undefined ? {} : { overview }),
    ...(diagram === undefined ? {} : { diagram }),
  };
}

function refusedDiagram(detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ detail, pointer: '/diagram' }] });
}

function whyNoDiagram(type: string): string {
  return type === 'workflow' ? 'Auto Studio draws a workflow from its steps' : 'only a function has one';
}

function diagramChosen(type: string, { diagram }: WrittenDefinition): Effect.Effect<void, InvalidInput> {
  const label = definitionResourceLabel(type);
  if (isPlaybookFunctionType(type)) {
    return diagram === undefined
      ? Effect.fail(
          refusedDiagram(
            `Say whether this ${label} has a diagram: give diagram as Mermaid source of a flowchart or a state diagram, or the word none when a picture would add nothing`,
          ),
        )
      : Effect.void;
  }
  return diagram === undefined
    ? Effect.void
    : Effect.fail(
        refusedDiagram(
          `${capitalized(articled(label))} takes no diagram, since ${whyNoDiagram(type)}; leave diagram out`,
        ),
      );
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

function preparedContentOf(
  capability: Capability,
  written: WrittenDefinition,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return Effect.gen(function* () {
    const { summary, check } = yield* capability.prepare(written.source);
    const stripped = yield* check(yield* PlaybookContext);
    return contentFrom(written, summary, stripped);
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}

export function contentOf(
  capability: Capability,
  written: WrittenDefinition,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return diagramChosen(capability.type, written).pipe(Effect.andThen(preparedContentOf(capability, written)));
}
