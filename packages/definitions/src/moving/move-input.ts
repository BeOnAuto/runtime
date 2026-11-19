import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { typeMeaning } from '../capability/known-capabilities.ts';
import { DefinitionNameField } from '../operations/definition-fields.ts';
import { definitionsDescription, forceDescription, toDescription } from './move-words.ts';

export const mostDefinitionsMovedAtOnce = 64;

export function moveInputOf(types: readonly string[]) {
  return Schema.Struct({
    to: PlaybookIdSchema.annotate({ description: toDescription }),
    definitions: Schema.Array(
      Schema.Struct({ type: Schema.Literals(types).annotate({ description: typeMeaning }), name: DefinitionNameField }),
    )
      .check(Schema.isMinLength(1), Schema.isMaxLength(mostDefinitionsMovedAtOnce))
      .annotate({ description: definitionsDescription }),
    force: Schema.optionalKey(Schema.Boolean.annotate({ description: forceDescription })),
  });
}
