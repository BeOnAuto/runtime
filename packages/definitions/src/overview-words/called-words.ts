import { asSentence } from '@on.auto/operations';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { definitionPhrase, type Phrases } from '../overview/overview.ts';
import type { CalledStanding, DefinitionCalled } from '../used-by/user-relations.ts';

const afterTheFirstParagraph = /\n[ \t]*\n[\s\S]*$/u;

const unheldWords: Readonly<Record<Exclude<CalledStanding, 'active'>, string>> = {
  retired: ', which is retired.',
  missing: ', which the playbook does not have yet.',
};

function firstParagraphOf(description: string): string {
  return description.trim().replace(afterTheFirstParagraph, '');
}

function heldWords(description: string | undefined): Phrases {
  return description === undefined || description.trim() === ''
    ? ['.']
    : [': ', asSentence(firstParagraphOf(description))];
}

export function calledSentence(called: DefinitionCalled): Phrases {
  const { type, standing, description } = called;
  return [
    `It calls the ${definitionResourceLabel(type)} `,
    definitionPhrase(called),
    ...(standing === 'active' ? heldWords(description) : [unheldWords[standing]]),
  ];
}
