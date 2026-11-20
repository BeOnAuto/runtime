import type { DefinitionNames } from '@on.auto/operations/definition-names';

import { goalNames, goalType, mostGoalsAPlaybookKeeps } from '../goals/goal-names.ts';
import { definitionNamesOf } from './definition-names.ts';

export {
  definitionBoundsHeld,
  definitionNamesOf,
  mostReactingDefinitions,
  unbounded,
  type DefinitionBounds,
} from './definition-names.ts';

export function definitionAndGoalNamesOf(
  types: readonly string[],
  mostActiveOf?: (type: string) => number,
): DefinitionNames {
  const definitions = definitionNamesOf(types, mostActiveOf);
  const holding = (stream: string): DefinitionNames => (goalNames.holdsNames(stream) ? goalNames : definitions);
  return {
    types: [...definitions.types, ...goalNames.types],
    holdsNames: (stream) => goalNames.holdsNames(stream) || definitions.holdsNames(stream),
    definitionKeyOf: (message) => holding(message.stream).definitionKeyOf(message),
    nameAfter: (held, message) => holding(message.stream).nameAfter(held, message),
    takenBy: (claimed, holder, changedBy) =>
      (claimed.definitionType === goalType ? goalNames : definitions).takenBy(claimed, holder, changedBy),
    bounds: [...(definitions.bounds ?? []), mostGoalsAPlaybookKeeps],
  };
}
