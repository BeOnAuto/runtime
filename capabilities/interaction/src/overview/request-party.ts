import { partyNamedUnderDetails, valueMeaning, type Phrases } from '@on.auto/definitions';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { Schema } from 'effect';

import { isLoneExpression } from '../run/value-rendering.ts';

const liquid = /\{[{%]/u;

export function partyOf({ text, variables }: ParsedTemplate, inputSchema: Schema.JsonObject | undefined): Phrases {
  const written = text.trim();
  const [only, ...others] = variables;
  if (isLoneExpression(written) && only !== undefined && others.length === 0) {
    return [valueMeaning(only.path, inputSchema)];
  }
  return liquid.test(written) || written.includes('\n') ? [partyNamedUnderDetails] : [written];
}
