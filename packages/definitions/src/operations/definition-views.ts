import { InvalidInput, PlaybookContext, type Unavailable } from '@on.auto/operations';
import { articled, capitalized } from '@on.auto/phrasing';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { withoutThePage, writtenInOf, type DocumentWrittenIn } from '../page/page-lines.ts';
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

type Kept = StoredDefinition & { readonly page?: DefinitionContent['page'] };

type PageCheck = (
  text: string,
  writtenIn: DocumentWrittenIn,
) => Effect.Effect<DefinitionContent['page'], InvalidInput | Unavailable>;

export function definitionOf(capability: Capability, stored: Kept): Definition {
  return {
    type: capability.type,
    media_type: capability.mediaType,
    ...Struct.omit(stored, ['details', 'stripped', 'page']),
    ...publishedDetails(stored),
  };
}

export function listedDefinitionOf(capability: Capability, stored: Kept): ListedDefinition {
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

function whyNoDiagram(type: string): string {
  return type === 'workflow' ? 'Auto Studio draws a workflow from its steps' : 'only a function has one';
}

function diagramChosen({ type }: Capability, { diagram }: WrittenDefinition): Effect.Effect<void, InvalidInput> {
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
  capability: Capability,
  written: WrittenDefinition,
  writtenIn: DocumentWrittenIn,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return Effect.gen(function* () {
    const { summary, check } = yield* capability.prepare(withoutThePage(written.source, writtenIn));
    const stripped = yield* check(yield* PlaybookContext);
    return contentFrom(written, summary, stripped);
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}

export function sourceToPrepare(type: string, source: string): string {
  return withoutThePage(source, writtenInOf(type));
}

function withItsPage(content: DefinitionContent, page: DefinitionContent['page']): DefinitionContent {
  return page === undefined ? content : { ...content, page };
}

export function checkedContentOf(
  capability: Capability,
  written: WrittenDefinition,
  pages: { readonly check: PageCheck },
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  const writtenIn = writtenInOf(capability.type);
  return diagramChosen(capability, written).pipe(
    Effect.andThen(preparedContentOf(capability, written, writtenIn)),
    Effect.flatMap((content) =>
      Effect.map(pages.check(written.source, writtenIn), (page) => withItsPage(content, page)),
    ),
  );
}
