import {
  changeKindOf,
  DefinitionContextSchema,
  type ChangesNamed,
  type PlacedFact,
  type ResourceChange,
} from '@on.auto/operations';
import { Schema } from 'effect';

import { defaultRunWords } from '../capability/capability.ts';
import type { DefinitionWords } from '../plain-language/definition-words.ts';

export const definitionChanged = changeKindOf('definition', 'A function or workflow saved or retired', {
  type: 'The type of the definition',
  name: 'The name of the definition',
});

export const runChanged = changeKindOf('run', 'A run that started, took an input or ended', {
  run_id: 'The id of the run',
});

const interactionChanged = changeKindOf('interaction', 'The request of a run, opened, answered or ended', {
  run_id: 'The id of the run that asks',
});

const decodeDefinitionContext = Schema.decodeUnknownSync(DefinitionContextSchema);

function idInItsKind(stream: string): string {
  return stream.slice(stream.indexOf('/') + 1);
}

export function definitionChangedBy({ context }: PlacedFact): readonly ResourceChange[] {
  const { definitionType, definitionName } = decodeDefinitionContext(context);
  return [definitionChanged.of({ type: definitionType, name: definitionName })];
}

export function runChangedBy({ stream }: PlacedFact): readonly ResourceChange[] {
  return [runChanged.of({ run_id: idInItsKind(stream) })];
}

export function runChangesOf(words: DefinitionWords, types: readonly string[]): ChangesNamed {
  const changedBy = (fact: PlacedFact): readonly ResourceChange[] => {
    const ofTheRun = { run_id: idInItsKind(fact.stream) };
    const asks = words.runWordsOf(fact.context.definitionType).deferralType !== defaultRunWords.deferralType;
    return asks ? [runChanged.of(ofTheRun), interactionChanged.of(ofTheRun)] : [runChanged.of(ofTheRun)];
  };
  return { kinds: [runChanged, interactionChanged], named: Object.fromEntries(types.map((type) => [type, changedBy])) };
}
