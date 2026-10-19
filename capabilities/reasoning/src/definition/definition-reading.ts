import { publishedOutputOf, type DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { parseDefinitionDocument } from './definition-parsing.ts';
import type { ReasoningFunctionDefinitionDocument } from './reasoning-function-definition.ts';

export function parse(source: string): Effect.Effect<ReasoningFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseDefinitionDocument(source), {
    onSuccess: (definition) => Effect.succeed(definition),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The reasoning function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

export function summarize({
  description,
  about,
  input,
  output,
  warnings,
}: ReasoningFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(about === undefined ? {} : { about }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.type === 'json' ? publishedOutputOf({ schema: output.schema.document, shape: output.shape }) : {}),
    warnings,
  };
}
