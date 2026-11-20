import {
  InvalidInput,
  PlaybookContext,
  type Notice,
  type PlaybookAddress,
  type Unavailable,
} from '@on.auto/operations';
import { articled, capitalized } from '@on.auto/phrasing';
import { Duration, Effect, Option, Ref } from 'effect';

import type { Capability, DefinitionSummary, PreparedDefinition } from '../capability/capability.ts';
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

export const saveNoticesBudgetMs = 2_000;

const noNotices: readonly Notice[] = [];

export const firstDefinitionNotice: Notice = {
  kind: 'first_definition',
  detail:
    "This is the playbook's first function or workflow. Has the person seen the workflow's steps in order, each with its function type, and said yes to that design? If not, show them the design now, in their words, and wait for their yes before you save anything else; if they change it, change what you just saved to match.",
  certainty: 'reminder',
};

export function noticesWithinBudget(
  { notices }: Pick<PreparedDefinition, 'notices'>,
  place: PlaybookAddress,
  budgetMs = saveNoticesBudgetMs,
): Effect.Effect<readonly Notice[]> {
  if (notices === undefined) {
    return Effect.succeed(noNotices);
  }
  return Effect.suspend(() => notices(place)).pipe(
    Effect.timeoutOption(Duration.millis(budgetMs)),
    Effect.map(Option.getOrElse(() => noNotices)),
    Effect.catchCause(() => Effect.succeed(noNotices)),
  );
}

type KeepNotices = (notices: readonly Notice[]) => Effect.Effect<void>;

interface NoticesOfASave {
  readonly keep: KeepNotices;
  readonly kept: Effect.Effect<readonly Notice[]>;
}

export const noticesOfASave: Effect.Effect<NoticesOfASave> = Effect.gen(function* () {
  const noticed = yield* Ref.make(noNotices);
  return { keep: (notices: readonly Notice[]) => Ref.set(noticed, notices), kept: Ref.get(noticed) };
});

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

function wordsFrom({ title, description }: DefinitionSummary): Pick<DefinitionContent, 'title' | 'description'> {
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  };
}

function contentFrom(
  written: WrittenDefinition,
  summary: DefinitionSummary,
  stripped: NonNullable<DefinitionContent['stripped']>,
): DefinitionContent {
  const { inputSchema, outputSchema, warnings = [], triggers = [], details } = summary;
  return {
    ...textMembersOf(textsAsWritten(written)),
    ...wordsFrom(summary),
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
  keepNotices: KeepNotices | undefined,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return Effect.gen(function* () {
    const prepared = yield* capability.prepare(withoutThePage(written.source, writtenIn));
    const place = yield* PlaybookContext;
    const stripped = yield* prepared.check(place);
    if (keepNotices !== undefined) {
      yield* keepNotices(yield* noticesWithinBudget(prepared, place));
    }
    return contentFrom(written, prepared.summary, stripped);
  }).pipe(Effect.catchTag('invalid_input', refusedSource));
}

export function sourceToPrepare(type: string, source: string): string {
  return withoutThePage(source, writtenInOf(type));
}

function withItsPage(content: DefinitionContent, page: DefinitionContent['page']): DefinitionContent {
  return page === undefined ? content : { ...content, page };
}

export function documentCheckedOf(
  capability: Capability,
  written: WrittenDefinition,
  pages: { readonly check: PageCheck },
  keepNotices?: KeepNotices,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  const writtenIn = writtenInOf(capability.type);
  return Effect.flatMap(preparedContentOf(capability, written, writtenIn, keepNotices), (content) =>
    Effect.map(pages.check(written.source, writtenIn), (page) => withItsPage(content, page)),
  );
}

export function checkedContentOf(
  capability: Capability,
  written: WrittenDefinition,
  pages: { readonly check: PageCheck },
  keepNotices?: KeepNotices,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext> {
  return Effect.andThen(diagramChosen(capability, written), documentCheckedOf(capability, written, pages, keepNotices));
}
