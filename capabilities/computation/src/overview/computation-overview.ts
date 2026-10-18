import { inputSection, outputSection, sectionOf, shownUnderSource, type OverviewParts } from '@on.auto/definitions';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';

export function computationOverview({ input, output }: ComputationFunctionDefinitionDocument): OverviewParts {
  return {
    body: [],
    sections: [
      inputSection(input.schema?.document),
      outputSection(output.schema?.document, output.shape),
      sectionOf('How it computes', shownUnderSource('program', 'The program')),
    ],
    appendix: [],
  };
}
