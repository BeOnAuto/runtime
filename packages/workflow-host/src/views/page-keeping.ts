import {
  DefinitionEventSchema,
  PageEventSchema,
  functionTypeOrder,
  isDefinitionSaved,
  pageDetailsIn,
  playbookPageViewNameOf,
  shapedViewsSchemaOf,
  type PageContent,
  type RecordedDefinitionEvent,
  type RecordedPageEvent,
  type StrippedForms,
} from '@on.auto/definitions';
import {
  carriedPagesOf,
  noPagesSavedAsDefinitions,
  pagesSavedAsDefinitionsAfter,
  pagesSavedAsDefinitionsType,
  playbookSubject,
  type CarriedPage,
  type PagesSavedAsDefinitions,
} from '@on.auto/definitions/page';
import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

import type { DefinitionsKeeping, KeptFunction, PlaybookDefinitions } from '../projector/playbook-definitions.ts';
import { runnableDetailsOf } from './view-details.ts';

const subjectTypes: readonly string[] = ['workflow', ...functionTypeOrder];

const playbookType = 'playbook';

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

const decodeOfThePlaybook = recordedDecoder(PageEventSchema);

export function pageViewDetailsOf(details: unknown, stripped?: StrippedForms): unknown {
  const data = pageDetailsIn(details)?.data;
  if (data === undefined) {
    return undefined;
  }
  const { language, fold, foldLine, filters, views } = data;
  const viewDetails = { language, fold, foldLine, filters, initial: {}, schema: shapedViewsSchemaOf(views) };
  return runnableDetailsOf(viewDetails, stripped);
}

type Pages = ReadonlyMap<string, KeptFunction>;

function savedAt(at: string): number {
  return Date.parse(at);
}

function closed(pages: Pages, key: string, version: number, at: string): Pages {
  return new Map(pages).set(key, { version, saved: savedAt(at), details: undefined });
}

function withPage(pages: Pages, key: string, page: PageContent | null, { version, at }: Saved): Pages {
  return page === null
    ? closed(pages, key, version, at)
    : new Map(pages).set(key, { version, saved: savedAt(at), details: pageViewDetailsOf(page.details, page.stripped) });
}

interface Saved {
  readonly version: number;
  readonly at: string;
}

function withoutPage(pages: Pages, key: string): Pages {
  const kept = new Map(pages);
  kept.delete(key);
  return kept;
}

function pagesOfASubject(type: string, pages: Pages, event: RecordedDefinitionEvent): Pages {
  const { at, definitionName, definitionVersion: version } = event.context;
  const key = `${type}/${definitionName}`;
  if (event.type === 'definition_retired') {
    return closed(pages, key, version, at);
  }
  if (!isDefinitionSaved(event)) {
    return pages;
  }
  const { page } = event.data.content;
  return page === undefined ? withoutPage(pages, key) : withPage(pages, key, page, { version, at });
}

function pagesOfThePlaybook(pages: Pages, event: RecordedPageEvent, version: number): Pages {
  return withPage(pages, playbookSubject, event.data.page, { version, at: event.context.at });
}

function subjectPagesAfter(type: string, previous: PlaybookDefinitions, messages: readonly unknown[]): Pages {
  return messages.reduce<Pages>(
    (pages, recorded) =>
      Option.match(decodeDefinitionEvent(recorded), {
        onNone: () => pages,
        onSome: (event) => pagesOfASubject(type, pages, event),
      }),
    previous.functions,
  );
}

function playbookPagesAfter(previous: PlaybookDefinitions, messages: readonly unknown[]): Pages {
  return messages.reduce<Pages>(
    (pages, recorded, index) =>
      Option.match(decodeOfThePlaybook(recorded), {
        onNone: () => pages,
        onSome: (event) => pagesOfThePlaybook(pages, event, previous.version + index + 1),
      }),
    previous.functions,
  );
}

function keptAfter(previous: PlaybookDefinitions, type: string, messages: readonly unknown[]): PlaybookDefinitions {
  const version = previous.version + messages.length;
  if (type === playbookType) {
    return { version, functions: playbookPagesAfter(previous, messages) };
  }
  if (type !== pagesSavedAsDefinitionsType) {
    return { version, functions: subjectPagesAfter(type, previous, messages) };
  }
  const savedAsDefinitions = messages.reduce<PagesSavedAsDefinitions>(
    (pages, recorded) =>
      Option.match(decodeDefinitionEvent(recorded), {
        onNone: () => pages,
        onSome: (event) => pagesSavedAsDefinitionsAfter(pages, event),
      }),
    previous.savedAsDefinitions ?? noPagesSavedAsDefinitions,
  );
  return { version, functions: previous.functions, savedAsDefinitions };
}

function carriedOf({ name, version, saved_at, details, stripped }: CarriedPage): KeptFunction {
  return { version, saved: savedAt(saved_at), details: pageViewDetailsOf(details, stripped), formerly: name };
}

function viewNameOf(playbookKey: string, subject: string): string {
  return subject === playbookSubject
    ? playbookPageViewNameOf({ playbook: String(playbookKey.split('/').at(-2)) })
    : subject;
}

type Named = readonly [string, KeptFunction];

function shownAs(playbookKey: string, [subject, kept]: Named): readonly Named[] {
  return kept.details === undefined ? [] : [[viewNameOf(playbookKey, subject), kept]];
}

function together(playbook: string, byType: ReadonlyMap<string, PlaybookDefinitions>): PlaybookDefinitions {
  const saved = [...byType]
    .filter(([type]: readonly [string, PlaybookDefinitions]) => type !== pagesSavedAsDefinitionsType)
    .flatMap(([, { functions }]: readonly [string, PlaybookDefinitions]) => Array.from(functions));
  const superseded = new Set(saved.map(([subject]: readonly [string, KeptFunction]) => subject));
  const carried = carriedPagesOf(
    byType.get(pagesSavedAsDefinitionsType)?.savedAsDefinitions ?? noPagesSavedAsDefinitions,
  );
  const pages = [
    ...saved,
    ...[...carried]
      .filter(([subject]: readonly [string, CarriedPage]) => !superseded.has(subject))
      .map(([subject, page]: readonly [string, CarriedPage]): readonly [string, KeptFunction] => [
        subject,
        carriedOf(page),
      ]),
  ];
  return {
    version: [...byType.values()].reduce((sum, { version }) => sum + version, 0),
    functions: new Map(pages.flatMap((named: Named) => shownAs(playbook, named))),
  };
}

export const pageKeeping: DefinitionsKeeping = {
  definitionTypes: [...subjectTypes, playbookType, pagesSavedAsDefinitionsType],
  keptAfter,
  together,
};
