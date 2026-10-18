import { inputSection, outputSection, paragraph, sectionOf, type OverviewParts } from '@on.auto/definitions';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';

export function computationOverview({ input, output }: ComputationFunctionDefinitionDocument): OverviewParts {
  return {
    body: [],
    sections: [
      inputSection(input.schema?.document),
      outputSection(output.schema?.document, output.shape),
      sectionOf('How it computes', paragraph('The program is TypeScript and is shown under Source.')),
    ],
    appendix: [],
  };
}
