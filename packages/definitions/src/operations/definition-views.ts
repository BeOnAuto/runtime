import { InvalidInput, PlaybookContext, type Unavailable } from '@on.auto/operations';
import { articled, capitalized } from '@on.auto/phrasing';
import { Effect } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { withoutThePage, writtenInOf, type DocumentWrittenIn } from '../page/page-lines.ts';
import { textMembersOf, textsAsWritten } from '../payloads/definition-texts.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { isPlaybookFunctionType } from '../registry/definition.ts';
import { rejectionOfSource, type Rejection } from './issue-pointers.ts';

type PageCheck = (
  text: string,
  writtenIn: DocumentWrittenIn,
) => Effect.Effect<DefinitionContent['page'], InvalidInput | Unavailable>;

export interface WrittenDefinition {
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
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
    ...textMembersOf(textsAsWritten(written)),
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
