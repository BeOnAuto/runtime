import { Buffer } from 'node:buffer';

import { momentVariables, unworkable } from '@on.auto/definitions/tool-blocks';
import type { Conflict, InvalidInput } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { clickTelling, resolvedTelling, type ConversationTools } from '../tellings/telling-routes.ts';
import type { Redraw, RequestRecord } from './request-record.ts';
import {
  checkedAnswerer,
  checkedParty,
  fromPart,
  messagePart,
  renderedPart,
  renderedRequest,
  toPart,
  type RenderedRequest,
} from './request-rendering.ts';
import { interactionBounds } from './run-bounds.ts';

type Variables = Readonly<Record<string, Schema.Json>>;

function answeringOf(
  document: RequestDocument,
  variables: Variables,
  to: string,
): Effect.Effect<Pick<RequestRecord, 'answerer' | 'reply'>, Conflict | InvalidInput> {
  const answerer =
    document.from === undefined
      ? Effect.succeed(to)
      : Effect.flatMap(renderedPart({ ...fromPart, template: document.from }, variables), checkedAnswerer);
  return Effect.map(answerer, (party) => ({
    answerer: party,
    ...(document.reply === undefined ? {} : { reply: document.reply }),
  }));
}

export interface ProvidedPart {
  readonly provider?: string;
  readonly part?: ConversationTools;
}

function messageOf(
  document: RequestDocument,
  variables: Variables,
  { input, now }: { readonly input: Schema.Json; readonly now: string },
): Effect.Effect<Pick<RequestRecord, 'message' | 'rendered' | 'buttons' | 'redraw'>, Conflict | InvalidInput> {
  if (document.render === undefined) {
    return Effect.map(renderedPart({ ...messagePart, template: document.message }, variables), (message) => ({
      message,
    }));
  }
  const { target, card } = document.render;
  const state = { input, today: now.slice(0, 10), now };
  return Effect.flatMap(renderedRequest(document.render, state), (request) =>
    request.buttons === undefined ? Effect.succeed(request) : withRedraw(request, { target, card, ...state }),
  );
}

function withRedraw(
  request: RenderedRequest,
  redraw: Redraw,
): Effect.Effect<RenderedRequest & { readonly redraw: Redraw }, Conflict> {
  const bytes = Buffer.byteLength(JSON.stringify(redraw), 'utf8');
  return bytes > interactionBounds.renderedBytes
    ? Effect.fail(
        unworkable(
          '',
          `The card and the input it reads take ${bytes} bytes, more than the ${interactionBounds.renderedBytes} a request with buttons may hold; show less of the input`,
        ),
      )
    : Effect.succeed({ ...request, redraw });
}

function tellingOf(
  route: RequestDocument['route'],
  buttons: RequestRecord['buttons'],
  part: ConversationTools | undefined,
): Pick<RequestRecord, 'replies' | 'tell'> {
  if (route?.replies !== undefined) {
    return { replies: route.replies, tell: resolvedTelling(route.deliver, route.replies, part) };
  }
  return buttons === undefined ? {} : { tell: clickTelling(part) };
}

export function requestOf(
  document: RequestDocument,
  input: Schema.Json,
  { provider, part }: ProvidedPart = {},
): Effect.Effect<RequestRecord, Conflict | InvalidInput> {
  return Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const now = new Date(at).toISOString();
    const variables = momentVariables(input, now);
    const to = yield* Effect.flatMap(renderedPart({ ...toPart, template: document.to }, variables), checkedParty);
    const message = yield* messageOf(document, variables, { input, now });
    const answerSchema = document.output.schema?.document;
    const answering =
      answerSchema === undefined
        ? {}
        : { answer_schema: answerSchema, ...(yield* answeringOf(document, variables, to)) };
    const { route } = document;
    return {
      to,
      ...message,
      ...answering,
      expires_at: new Date(at + document.expiresMs).toISOString(),
      requested_at: now,
      ...(route === undefined ? {} : { deliver: route.deliver }),
      ...tellingOf(route, message.buttons, part),
      ...(provider === undefined ? {} : { provider }),
    };
  });
}

export function asksLater(document: RequestDocument): boolean {
  return document.route !== undefined || document.output.schema !== undefined;
}
