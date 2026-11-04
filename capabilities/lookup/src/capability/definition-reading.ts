import { outputInWords, publishedOutputOf, type DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { renderClock } from '@on.auto/definitions/template';
import { callOutputInWords } from '@on.auto/definitions/tool-blocks';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseLookupDocument } from '../document/document-parsing.ts';
import type { LookupFunctionDefinitionDocument } from '../document/lookup-document.ts';
import { runsAnswerSchema } from '../runs/runs-answer.ts';
import { runsOutputInWords } from '../runs/runs-words.ts';

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

function readingSummaryOf(document: LookupFunctionDefinitionDocument): DefinitionSummary {
  if (document.kind === 'call') {
    const { output, call } = document;
    return { outputSchema: output.schema.document, details: { call: { server: call.server, tool: call.tool } } };
  }
  const { type, name } = document.runs;
  return publishedOutputOf({ schema: runsAnswerSchema, details: { reads: [{ type, name }] } });
}

export function summarize(document: LookupFunctionDefinitionDocument): DefinitionSummary {
  const { description, input } = document;
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...readingSummaryOf(document),
  };
}

const answerInWords = outputInWords('answer');

export function describeLookup(output: Schema.Json, record?: Schema.JsonObject): string {
  return callOutputInWords(output, record) ?? runsOutputInWords(output, record) ?? answerInWords(output);
}
