import type { DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { renderClock } from '@on.auto/definitions/template';
import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import type { InteractionFunctionDefinitionDocument, SignInDocument } from '../document/interaction-document.ts';
import { signInCheck } from '../sign-in/sign-in-questions.ts';
import { callCheck } from './call-check.ts';
import { wayCheck, type WayPorts } from './request-ways.ts';

function parse(source: string): Effect.Effect<InteractionFunctionDefinitionDocument, InvalidInput> {
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

function signInDetailsOf({ signIn, whenSignedOut }: SignInDocument): Schema.JsonObject {
  const said = whenSignedOut.answer === 'unsaid' ? {} : { if_signed_out: whenSignedOut.answer };
  const details = { sign_in: { server: signIn.server, site: signIn.site, ...said } };
  if (whenSignedOut.answer !== 'ask') {
    return details;
  }
  const { expires, route } = whenSignedOut.asking;
  return route === undefined
    ? { ...details, expires }
    : { ...details, expires, deliver: { server: route.deliver.server, tool: route.deliver.tool } };
}

function detailsOf(document: InteractionFunctionDefinitionDocument): Schema.JsonObject {
  if (document.shape === 'call') {
    return { call: { server: document.call.server, tool: document.call.tool } };
  }
  if (document.shape === 'sign_in') {
    return signInDetailsOf(document);
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

export function definitionReadingOf(tools: WayPorts) {
  const calls = callCheck(tools);
  const ways = wayCheck(tools);
  const signIns = signInCheck(tools);
  const checks = (document: InteractionFunctionDefinitionDocument, source: string, place: PlaybookAddress) => {
    if (document.shape === 'sign_in') {
      return signIns(document, place);
    }
    return document.shape === 'call' ? calls(document, place) : ways(document, source, place);
  };
  return { parse, check: checks, summarize };
}
