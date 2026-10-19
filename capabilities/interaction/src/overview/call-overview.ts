import { callSection, callSentence, inputDetails, outputDetails, type ToldParts } from '@on.auto/definitions';

import type { CallDocument } from '../document/interaction-document.ts';

export function callOverview({ call, input, output }: CallDocument): ToldParts {
  const { server, tool, read } = call;
  const given = input.schema?.document;
  const answered = output.schema.document;
  return {
    body: [callSentence({ input: given, server, tool, read, output: answered })],
    appendix: [inputDetails(given), outputDetails(answered), callSection({ server, tool, read, arguments: call.with })],
  };
}
