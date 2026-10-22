import type { DefinitionSummary } from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import { ViewDetailsSchema } from '@on.auto/workflow-host';
import { Effect, Result, Schema } from 'effect';

import { invalidDefinition } from '../document/document-check.ts';
import { parseRecallDocument } from '../document/document-parsing.ts';
import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';

const encodeDetails = Schema.encodeSync(ViewDetailsSchema);

export function parse(source: string): Effect.Effect<RecallFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseRecallDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
  });
}

export function summarize({
  description,
  input,
  output,
  details,
}: RecallFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.schema === undefined ? {} : { outputSchema: output.schema.document }),
    details: encodeDetails(details),
  };
}
