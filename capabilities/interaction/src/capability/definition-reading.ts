import type { DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { renderClock } from '@on.auto/definitions/template';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';

export function parse(source: string): Effect.Effect<InteractionFunctionDefinitionDocument, InvalidInput> {
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(parseInteractionDocument(source, clock), {
      onSuccess: (document) => Effect.succeed(document),
      onFailure: (issues) =>
        Effect.fail(
          new InvalidInput({
            detail: `The interaction function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
            issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
          }),
        ),
    }),
  );
}

function detailsOf(document: InteractionFunctionDefinitionDocument): Schema.JsonObject {
  if (document.shape === 'call') {
    return { call: { server: document.call.server, tool: document.call.tool } };
  }
  const { expires, route } = document;
  return route === undefined
    ? { expires }
    : { expires, deliver: { server: route.deliver.server, tool: route.deliver.tool } };
}

export function summarize(document: InteractionFunctionDefinitionDocument): DefinitionSummary {
  const { description, input, output } = document;
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.schema === undefined ? {} : { outputSchema: output.schema.document }),
    details: detailsOf(document),
  };
}
