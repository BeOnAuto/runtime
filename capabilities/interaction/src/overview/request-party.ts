import { partyNamedUnderDetails, valueMeaning, type Phrases } from '@on.auto/definitions';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { Schema } from 'effect';

const oneOutput = /^\{\{[^{}]*\}\}$/u;

const liquid = /\{[{%]/u;

export function partyOf({ text, variables }: ParsedTemplate, inputSchema: Schema.JsonObject | undefined): Phrases {
  const written = text.trim();
  const [only, ...others] = variables;
  if (oneOutput.test(written) && only !== undefined && others.length === 0) {
    return [valueMeaning(only.path, inputSchema)];
  }
  return liquid.test(written) || written.includes('\n') ? [partyNamedUnderDetails] : [written];
}
