import { computedSentence, inputDetails, outputDetails, programSection, type ToldParts } from '@on.auto/definitions';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';

export function computationOverview({ language, input, output }: ComputationFunctionDefinitionDocument): ToldParts {
  return {
    body: [computedSentence({ input: input.schema?.document, output: output.schema?.document, shape: output.shape })],
    appendix: [
      inputDetails(input.schema?.document),
      outputDetails(output.schema?.document, output.shape),
      programSection(language),
    ],
  };
}
