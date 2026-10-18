import {
  bulletList,
  definitionResourceLabel,
  named,
  paragraph,
  sectionOf,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { allTaskEntries, field, type JsonObject, type TaskEntry } from '@on.auto/workflow-engine';

import { definitionCallOf, namesItsDefinition, type RunDefinitionCall } from '../document/workflow-functions.ts';

interface Called {
  readonly key: string;
  readonly words: Phrases;
}

function calledBy({ name, reference }: TaskEntry, call: RunDefinitionCall): Called {
  return namesItsDefinition(call)
    ? { key: `${call.type}/${call.name}`, words: [`the ${definitionResourceLabel(call.type)} `, named(call.name)] }
    : { key: reference, words: ['the definition that its step ', named(name), ' names when it runs'] };
}

function calledIn(entry: TaskEntry): readonly Called[] {
  const call = definitionCallOf(entry.task);
  return call === undefined ? [] : [calledBy(entry, call)];
}

export function calledSection(document: JsonObject): OverviewSection {
  const called = new Map(
    allTaskEntries(field(document, 'do'), '/do')
      .flatMap((entry) => calledIn(entry))
      .map(({ key, words }) => [key, words] as const),
  );
  return called.size === 0
    ? sectionOf('What it calls', paragraph('It calls no function or workflow.'))
    : sectionOf('What it calls', paragraph('Its steps call:'), bulletList([...called.values()]));
}
