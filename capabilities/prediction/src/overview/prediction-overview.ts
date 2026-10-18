import { bulletList, paragraph, sectionOf, type OverviewParts, type OverviewSection } from '@on.auto/definitions';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { learnedSection } from './data-words.ts';
import { goingLiveSection } from './evaluation-words.ts';
import { predictedSection } from './predicts-words.ts';
import { trainerSection } from './trainer-words.ts';

function rulesSections(rules: readonly string[]): readonly OverviewSection[] {
  return rules.length === 0
    ? []
    : [
        sectionOf(
          'Rules',
          paragraph('Its trainer follows these rules, and the card of each version states them:'),
          bulletList(rules.map((rule) => [rule])),
        ),
      ];
}

export function predictionOverview(document: PredictionFunctionDefinitionDocument): OverviewParts {
  return {
    body: [],
    sections: [
      predictedSection(document.predicts, document.data),
      learnedSection(document),
      trainerSection(document.source, document.brief),
      goingLiveSection(document),
      ...rulesSections(document.rules),
    ],
    appendix: [],
  };
}
