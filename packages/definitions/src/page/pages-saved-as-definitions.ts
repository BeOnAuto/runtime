import { PlaybookReader, type Fold } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { StrippedForms } from '../capability/stripped-forms.ts';
import {
  DefinitionEventSchema,
  isDefinitionSaved,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { carriedPageSourceOf } from './old-page-sources.ts';
import { pageDetailsOf } from './page-details-of.ts';
import type { SubjectPage } from './page-facts.ts';
import { playbookSubject } from './subject-pages-port.ts';

export const pagesSavedAsDefinitionsType = 'page';

const SavedAsADefinitionSchema = Schema.Struct({ of: Schema.String });

const subjectOf = Schema.decodeUnknownOption(SavedAsADefinitionSchema);

interface PageSavedAsADefinition {
  readonly version: number;
  readonly source: string;
  readonly of: string;
  readonly stripped?: StrippedForms;
  readonly at: string;
}

export type PagesSavedAsDefinitions = ReadonlyMap<string, PageSavedAsADefinition>;

export const noPagesSavedAsDefinitions: PagesSavedAsDefinitions = new Map();

export interface CarriedPage extends SubjectPage {
  readonly name: string;
  readonly saved_at: string;
  readonly stripped?: StrippedForms;
}

export type CarriedPages = ReadonlyMap<string, CarriedPage>;

export function pagesSavedAsDefinitionsAfter(
  pages: PagesSavedAsDefinitions,
  event: RecordedDefinitionEvent,
): PagesSavedAsDefinitions {
  const { at, definitionName: name, definitionVersion: version } = event.context;
  const kept = new Map(pages);
  if (event.type === 'definition_retired') {
    kept.delete(name);
    return kept;
  }
  if (!isDefinitionSaved(event)) {
    return pages;
  }
  const { source, details, stripped } = event.data.content;
  return Option.match(subjectOf(details), {
    onNone: () => pages,
    onSome: ({ of }) => kept.set(name, { version, source, of, ...(stripped === undefined ? {} : { stripped }), at }),
  });
}

const frontMatterDelimiter = /^---[ \t]*\r?$/u;

const subjectLine = /^of:/u;

export function sourceWithoutItsSubject(source: string): string {
  const lines = source.split('\n');
  const closing = lines.findIndex((line, index) => index > 0 && frontMatterDelimiter.test(line));
  const at = lines.findIndex((line, index) => index > 0 && index < closing && subjectLine.test(line));
  return at === -1 ? source : lines.toSpliced(at, 1).join('\n');
}

function carriedOf(name: string, page: PageSavedAsADefinition): readonly (readonly [string, CarriedPage])[] {
  const carried = carriedPageSourceOf(sourceWithoutItsSubject(page.source), page.of === playbookSubject);
  if (carried === undefined) {
    return [];
  }
  const { source, document } = carried;
  return [
    [
      page.of,
      {
        name,
        version: page.version,
        source,
        details: pageDetailsOf(document),
        ...(page.stripped === undefined ? {} : { stripped: page.stripped }),
        saved_at: page.at,
      },
    ],
  ];
}

export function carriedPagesOf(pages: PagesSavedAsDefinitions): CarriedPages {
  return new Map(
    [...pages].flatMap(([name, page]: readonly [string, PageSavedAsADefinition]) => carriedOf(name, page)),
  );
}

const pagesSavedAsDefinitionsFold: Fold<PagesSavedAsDefinitions, RecordedDefinitionEvent> = {
  initialState: noPagesSavedAsDefinitions,
  evolve: pagesSavedAsDefinitionsAfter,
  eventSchema: DefinitionEventSchema,
};

export const carriedPagesIn: Effect.Effect<CarriedPages, never, PlaybookReader> = PlaybookReader.use((reader) =>
  reader.load(definitionTypeStreamOf(pagesSavedAsDefinitionsType), pagesSavedAsDefinitionsFold),
).pipe(Effect.map(({ state }) => carriedPagesOf(state)));

export function carriedPageOf(subject: string): Effect.Effect<CarriedPage | undefined, never, PlaybookReader> {
  return Effect.map(carriedPagesIn, (carried) => carried.get(subject));
}
