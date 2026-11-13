import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { momentVariables } from '@on.auto/definitions/tool-blocks';
import type { Conflict, InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { resolvedTelling, type ConversationTools } from '../tellings/telling-routes.ts';
import { routeOf, toolsOf } from '../tool-blocks/routes.ts';
import { checkedArguments, offered, roomFor, type InteractionPorts } from './request-reach.ts';
import type { RequestRecord } from './request-record.ts';
import {
  checkedAnswerer,
  checkedParty,
  fromPart,
  messagePart,
  renderedPart,
  renderedRequest,
  toPart,
} from './request-rendering.ts';

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

interface ProvidedPart {
  readonly provider?: string;
  readonly part?: ConversationTools;
}

function messageOf(
  document: RequestDocument,
  variables: Variables,
  { input, now }: { readonly input: Schema.Json; readonly now: string },
): Effect.Effect<Pick<RequestRecord, 'message' | 'rendered'>, Conflict | InvalidInput> {
  if (document.render === undefined) {
    return Effect.map(renderedPart({ ...messagePart, template: document.message }, variables), (message) => ({
      message,
    }));
  }
  return renderedRequest(document.render, { input, today: now.slice(0, 10), now });
}

function requestOf(
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
      ...(route?.replies === undefined
        ? {}
        : { replies: route.replies, tell: resolvedTelling(route.deliver, route.replies, part) }),
      ...(provider === undefined ? {} : { provider }),
    };
  });
}

function partOf(
  ports: InteractionPorts,
  playbook: PlaybookAddress,
  { route }: RequestDocument,
): Effect.Effect<ProvidedPart> {
  if (route?.replies === undefined) {
    return Effect.succeed({});
  }
  const { server } = route.deliver;
  return Effect.gen(function* () {
    const servers = yield* ports.tools.listServers(playbook, server);
    const provider = servers.find(({ name }) => name === server)?.provider ?? undefined;
    const part = yield* ports.conversationsOf(provider ?? null);
    return { ...(provider === undefined ? {} : { provider }), ...(part === undefined ? {} : { part }) };
  });
}

export function asksLater(document: RequestDocument): boolean {
  return document.route !== undefined || document.output.schema !== undefined;
}

export function requestRun(ports: InteractionPorts) {
  return (
    document: RequestDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* checkedInput(input, document.input.schema, functionResourceLabels.interaction.singular);
      const playbook = { org: context.org, playbook: context.playbook };
      yield* offered(toolsOf(routeOf(document.route ?? {})), ports, playbook);
      if (!asksLater(document)) {
        const notified = yield* requestOf(document, admitted);
        return { output: {}, record: notified };
      }
      yield* roomFor(ports, playbook);
      const record = yield* requestOf(document, admitted, yield* partOf(ports, playbook, document));
      yield* checkedArguments(record, { input: admitted, runId: context.id, functionName: context.definition.name });
      return { finishesLater: true, record };
    });
}
