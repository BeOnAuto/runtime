import { calledSentence } from '../overview-words/called-words.ts';
import { callerSentence } from '../overview-words/caller-words.ts';
import { exactNameWithType } from '../overview-words/exact-name-words.ts';
import { markdownOf } from '../overview/markdown-writer.ts';
import {
  bulletList,
  decodedOverview,
  paragraph,
  sectionOf,
  type Overview,
  type OverviewBlock,
  type OverviewSection,
  type Phrases,
} from '../overview/overview.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import type { NamedDefinition } from './called-definitions.ts';
import { definitionsCalled, usersOf, type PlaybookRegistries } from './definition-users.ts';
import type { DefinitionCalled, DefinitionUser } from './user-relations.ts';

export interface ReadKnowledge {
  readonly users: readonly DefinitionUser[];
  readonly called: readonly DefinitionCalled[];
}

const calledHeading = 'What it calls';

const usersHeading = 'Used by';

function sectionsOf(heading: string, blocks: readonly OverviewBlock[]): readonly OverviewSection[] {
  return blocks.length === 0 ? [] : [sectionOf(heading, ...blocks)];
}

function listOf(items: readonly Phrases[]): readonly OverviewBlock[] {
  return items.length === 0 ? [] : [bulletList(items)];
}

function exactNamesOf(definitions: readonly NamedDefinition[]): readonly OverviewBlock[] {
  const unique = definitions.filter(
    ({ type, name }, index) => definitions.findIndex((other) => other.type === type && other.name === name) === index,
  );
  return listOf(unique.map((definition) => exactNameWithType(definition)));
}

export function overviewAtRead(overview: Overview, { users, called }: ReadKnowledge): string {
  return markdownOf({
    ...overview,
    sections: [
      ...overview.sections,
      ...sectionsOf(
        calledHeading,
        called.map((definition) => paragraph(...calledSentence(definition))),
      ),
      ...sectionsOf(usersHeading, listOf(users.map((user) => callerSentence(user)))),
    ],
    appendix: [
      ...overview.appendix,
      ...sectionsOf(calledHeading, exactNamesOf(called)),
      ...sectionsOf(usersHeading, exactNamesOf(users)),
    ],
  });
}

export function overviewReadFrom(
  registries: PlaybookRegistries,
  type: string,
  { name, overview, details }: Pick<StoredDefinition, 'name' | 'overview' | 'details'>,
): string {
  return overviewAtRead(decodedOverview(overview), {
    users: usersOf(registries, { type, name }),
    called: definitionsCalled(registries, details),
  });
}
