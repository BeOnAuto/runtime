import { InvalidInput, PlaybookContext, type Unavailable } from '@on.auto/operations';
import { articled, capitalized } from '@on.auto/phrasing';
import { Effect, Order, Struct } from 'effect';

import type { DefinitionSummary } from '../capability/capability.ts';
import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
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

function publishedDetails({ presents }: DefinitionKind, { details }: StoredDefinition): Pick<Definition, 'details'> {
  if (presents !== undefined) {
    return { details: presents.publishedDetails(details) };
  }
  const shape = shapeNameIn(details);
  return shape === undefined ? {} : { details: { shape } };
}

export function definitionOf(capability: DefinitionKind, stored: StoredDefinition): Definition {
  return {
    type: capability.type,
    media_type: capability.mediaType,
    ...Struct.omit(stored, ['details', 'stripped']),
    ...publishedDetails(capability, stored),
  };
}

export function listedDefinitionOf(capability: DefinitionKind, stored: StoredDefinition): ListedDefinition {
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

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ detail, pointer }] });
}

function refusedDiagram(detail: string): InvalidInput {
  return refusedAt('/diagram', detail);
}

const showsItself = 'Auto Studio shows the page itself';

function whyNoDiagram({ type, presents }: DefinitionKind): string {
  if (presents !== undefined) {
    return showsItself;
  }
  return type === 'workflow' ? 'Auto Studio draws a workflow from its steps' : 'only a function has one';
}

function overviewChosen(
  { type, presents }: DefinitionKind,
  { overview }: WrittenDefinition,
): Effect.Effect<void, InvalidInput> {
  return presents === undefined || overview === undefined
    ? Effect.void
    : Effect.fail(
        refusedAt(
          '/overview',
          `${capitalized(articled(definitionResourceLabel(type)))} takes no overview, since ${showsItself}; leave overview out`,
        ),
      );
}

function diagramChosen(capability: DefinitionKind, { diagram }: WrittenDefinition): Effect.Effect<void, InvalidInput> {
  const { type } = capability;
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
          `${capitalized(articled(label))} takes no diagram, since ${whyNoDiagram(capability)}; leave diagram out`,
        ),
      );
}

function contentFrom(
  written: WrittenDefinition,
  { description, inputSchema, outputSchema, warnings = [], triggers = [], details }: DefinitionSummary,
  stripped: NonNullable<DefinitionContent['stripped']>,
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
  capability: DefinitionKind,
  written: WrittenDefinition,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return Effect.gen(function* () {
    const { summary, check } = yield* capability.prepare(written.source);
    const stripped = yield* check(yield* PlaybookContext);
    return contentFrom(written, summary, stripped);
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}

export function checkedContentOf(
  capability: DefinitionKind,
  written: WrittenDefinition,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return overviewChosen(capability, written).pipe(
    Effect.andThen(diagramChosen(capability, written)),
    Effect.andThen(preparedContentOf(capability, written)),
  );
}
