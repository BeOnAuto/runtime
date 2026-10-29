import type { Presenter } from '@on.auto/operations';

import type { Capability } from '../capability/capability.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { composedFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { runChangesOf } from './changed-resources.ts';
import { definitionPresenter } from './definition-presenter.ts';
import { publishedEventPresenter } from './published-event-presenter.ts';
import { reactionRefusedPresenter } from './reaction-refused-presenter.ts';
import { runPresenter } from './run-presenter.ts';

export function makeDefinitionPresenters(
  capabilities: readonly Capability[],
  facts: CapabilityFacts = composedFactsOf(capabilities),
): readonly Presenter[] {
  const words = definitionWordsFor(capabilities);
  const runs = runPresenter(words, facts.onRuns);
  return [
    { ...runs, changes: runChangesOf(words, Object.keys(runs.publicNames)) },
    definitionPresenter(words),
    publishedEventPresenter,
    reactionRefusedPresenter,
    ...facts.streams,
  ];
}
