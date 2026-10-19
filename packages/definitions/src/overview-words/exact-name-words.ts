import { articled } from '@on.auto/operations';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { definitionPhrase, type PhrasedDefinition, type Phrases } from '../overview/overview.ts';

export function exactNameWithType({ type, name }: PhrasedDefinition): Phrases {
  return [definitionPhrase({ type, name }), `, ${articled(definitionResourceLabel(type))}`];
}
