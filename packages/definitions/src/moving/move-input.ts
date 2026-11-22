import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { typeMeaning } from '../capability/known-capabilities.ts';
import { mostGoals } from '../goals/goals-document.ts';
import { DefinitionNameField } from '../operations/definition-fields.ts';
import {
  definitionsDescription,
  definitionsWithGoalsDescription,
  forceDescription,
  goalsDescription,
  toDescription,
  toWithGoalsDescription,
} from './move-words.ts';

export const mostDefinitionsMovedAtOnce = 64;

function definitionsOf(types: readonly string[], most: number) {
  return Schema.Array(
    Schema.Struct({ type: Schema.Literals(types).annotate({ description: typeMeaning }), name: DefinitionNameField }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(most));
}

const force = Schema.optionalKey(Schema.Boolean.annotate({ description: forceDescription }));

export function moveInputOf(types: readonly string[]) {
  return Schema.Struct({
    to: PlaybookIdSchema.annotate({ description: toDescription }),
    definitions: definitionsOf(types, mostDefinitionsMovedAtOnce).annotate({ description: definitionsDescription }),
    force,
  });
}

export function moveWithGoalsInputOf(types: readonly string[]) {
  return Schema.Struct({
    to: PlaybookIdSchema.annotate({ description: toWithGoalsDescription }),
    definitions: Schema.optionalKey(
      definitionsOf(types, mostDefinitionsMovedAtOnce).annotate({ description: definitionsWithGoalsDescription }),
    ),
    goals: Schema.optionalKey(
      Schema.Array(Schema.String)
        .check(Schema.isMinLength(1), Schema.isMaxLength(mostGoals))
        .annotate({ description: goalsDescription }),
    ),
    force,
  });
}
