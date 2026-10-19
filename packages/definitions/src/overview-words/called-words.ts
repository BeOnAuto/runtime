import { asSentence } from '@on.auto/operations';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { firstParagraphOf } from '../overview/markdown-text.ts';
import { definitionPhrase, type Phrases } from '../overview/overview.ts';
import type { CalledStanding, DefinitionCalled } from '../used-by/user-relations.ts';

const unheldWords: Readonly<Record<Exclude<CalledStanding, 'active'>, string>> = {
  retired: ', which is retired.',
  missing: ', which the playbook does not have yet.',
};

function heldWords(description: string | undefined): Phrases {
  if (description === undefined || description.trim() === '') {
    return ['.'];
  }
  const { text, endsInProse } = firstParagraphOf(description.trim());
  return [': ', endsInProse ? asSentence(text) : text];
}

export function calledSentence(called: DefinitionCalled): Phrases {
  const { type, standing, description } = called;
  return [
    `It calls the ${definitionResourceLabel(type)} `,
    definitionPhrase(called),
    ...(standing === 'active' ? heldWords(description) : [unheldWords[standing]]),
  ];
}
