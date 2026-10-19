import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { definitionPhrase, listedPhrases, named, type Phrases } from '../overview/overview.ts';
import { readableName } from '../plain-language/in-words.ts';
import type { CallingStep, UserRelation } from '../used-by/called-definitions.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';

const relationWords: Readonly<Record<UserRelation, string>> = {
  calls: 'calls it',
  'sends-builds': 'sends it builds to train',
  'asks-approval': 'asks it to approve a version',
  'remembers-runs': 'remembers its runs',
  'remembers-changes': 'remembers its changes',
};

function stepWords({ number, name }: CallingStep): Phrases {
  return [`in step ${number}, `, named(readableName(name))];
}

function stepsWords(steps: readonly CallingStep[] | undefined): Phrases {
  return steps === undefined
    ? []
    : [
        ' ',
        ...listedPhrases(
          steps.map((step) => stepWords(step)),
          'and',
          'serial-when-items-hold-commas',
        ),
      ];
}

export function callerSentence(user: DefinitionUser): Phrases {
  return [
    `The ${definitionResourceLabel(user.type)} `,
    definitionPhrase(user),
    ` ${relationWords[user.relation]}`,
    ...stepsWords(user.steps),
    '.',
  ];
}
