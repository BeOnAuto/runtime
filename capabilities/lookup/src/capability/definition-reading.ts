import { outputInWords, type DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { renderClock } from '@on.auto/definitions/template';
import { callOutputInWords } from '@on.auto/definitions/tool-blocks';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseLookupDocument } from '../document/document-parsing.ts';
import type { LookupFunctionDefinitionDocument } from '../document/lookup-document.ts';

export function parse(source: string): Effect.Effect<LookupFunctionDefinitionDocument, InvalidInput> {
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(parseLookupDocument(source, clock), {
      onSuccess: (document) => Effect.succeed(document),
      onFailure: (issues) =>
        Effect.fail(
          new InvalidInput({
            detail: `The lookup function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
            issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
          }),
        ),
    }),
  );
}

export function summarize({ description, input, output, call }: LookupFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    outputSchema: output.schema.document,
    details: { call: { server: call.server, tool: call.tool } },
  };
}

const answerInWords = outputInWords('answer');

export function describeLookup(output: Schema.Json, record?: Schema.JsonObject): string {
  return callOutputInWords(output, record) ?? answerInWords(output);
}
