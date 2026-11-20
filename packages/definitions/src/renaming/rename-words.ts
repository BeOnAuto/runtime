import { capitalized, quoted } from '@on.auto/phrasing';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { runsNotEndedSentence } from '../moving/move-words.ts';
import type { DefinitionWords } from '../plain-language/definition-words.ts';
import type { NamedDefinition } from '../used-by/called-definitions.ts';

export const newNameDescription =
  'The name to give the definition: 3 to 48 lowercase letters, digits and hyphens, starting with a letter. Give it alone; its versions, runs, page and schedule stay with it';

export const diagramWhenGiven = 'Required for a function with `source`, refused for a workflow and with `new_name`';

export const updatedDefinitionsDescription =
  'On a rename, the definitions saved again with the new name, each by its `type` and `name`';

export const updatedTypeDescription = 'The type of the definition saved again';

export const updatedNameDescription = 'The name of the definition saved again';

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export const neitherGiven = 'Give `source`, the whole new document, or `new_name`';

export const bothGiven = 'Give `source` to save a new version or `new_name` to rename, one in a call';

export const theNameItHas = '`new_name` is the name it has; give another name';

export const textsOfAVersion = '`overview` and `diagram` go with `source`; give `new_name` alone to rename';

export function renameAttempt(words: DefinitionWords, { type, name }: NamedDefinition, to: string): string {
  return `rename ${words.named(type, name)} to ${quoted(to)}`;
}

function savedAgainWords(words: DefinitionWords, updated: readonly NamedDefinition[]): string {
  if (updated.length === 0) {
    return '';
  }
  const named = capitalized(listed.format(updated.map(({ type, name }) => words.named(type, name))));
  return updated.length === 1
    ? ` ${named} has a new version with the new name.`
    : ` ${named} each have a new version with the new name.`;
}

export function renameOutcome(
  words: DefinitionWords,
  renamed: NamedDefinition & { readonly from: string },
  updated: readonly NamedDefinition[],
): string {
  const { type, name, from } = renamed;
  return `Renamed ${words.named(type, from)} to ${quoted(name)}. Its versions, runs, page and schedule stay with it.${savedAgainWords(words, updated)}`;
}

const renamedChange = 'be renamed';

export function runsNotEndedOfTheRenamed(holder: NamedDefinition, count: number, runId: string): string {
  return runsNotEndedSentence({ holder, change: renamedChange }, count, runId);
}

interface RenamedOnesUser extends NamedDefinition {
  readonly callsOrReads: boolean;
}

function relationOf({ callsOrReads }: RenamedOnesUser): string {
  return callsOrReads ? 'uses' : 'waits for runs of';
}

export function runsNotEndedOfAUser(renamed: string) {
  return (holder: RenamedOnesUser, count: number, runId: string): string =>
    runsNotEndedSentence(
      { holder, change: renamedChange, use: { relation: relationOf(holder), of: renamed } },
      count,
      runId,
    );
}

export function takenByARetiredOne({ type, name }: NamedDefinition, from: string): string {
  return `The playbook has a retired ${definitionResourceLabel(type)} ${name}, which keeps its name while retired, so ${from} cannot take it; tell the person, who can choose another name`;
}

export function tooManyUsersWords({ type, name }: NamedDefinition, users: number, most: number): string {
  return `The ${definitionResourceLabel(type)} ${name} is used by ${users} definitions, and a rename saves at most ${most} of them again at once, so it cannot be renamed; tell the person`;
}
