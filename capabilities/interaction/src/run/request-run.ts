import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { inputReadBy, unreadAssetOf, type VariableReference } from '@on.auto/definitions/template';
import type { Conflict, InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { Effect, JsonPointer, type Schema } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { stateReadsOf } from '../rendering/state-reads.ts';
import { routeOf, toolsOf } from '../tool-blocks/routes.ts';
import { asksLater, requestOf, type ProvidedPart } from './interaction-run.ts';
import { checkedArguments, offered, roomFor, type InteractionPorts } from './request-reach.ts';
import { interactionBounds } from './run-bounds.ts';

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

function cardReadsOf(card: Schema.Json): readonly VariableReference[] {
  return stateReadsOf(card).flatMap(({ path }) => {
    const [root, ...members] = path
      .split('/')
      .slice(1)
      .map((token) => JsonPointer.unescapeToken(token));
    return root === 'input' ? [{ path: [root, ...members], line: 1 }] : [];
  });
}

function partsRead(document: RequestDocument): readonly VariableReference[] {
  return [
    ...document.to.variables,
    ...(document.from?.variables ?? []),
    ...(document.render === undefined ? document.message.variables : cardReadsOf(document.render.card)),
  ];
}

function inputReadIn(
  ports: InteractionPorts,
  document: RequestDocument,
  input: Schema.Json,
  playbook: PlaybookAddress,
): Effect.Effect<Schema.Json, Conflict | InvalidInput> {
  const bound = {
    most: interactionBounds.messageBytes,
    unit: 'bytes',
    reader: 'a request may hold',
    remedy: 'give it a shorter text',
  } as const;
  return Effect.mapError(
    inputReadBy(partsRead(document), input, { holding: ports.tools.assets, playbook, bound }),
    unreadAssetOf,
  );
}

export function requestRun(ports: InteractionPorts) {
  return (
    document: RequestDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* checkedInput(
        input,
        document.input.schema,
        functionResourceLabels.interaction.singular,
        'passed_whole',
      );
      const playbook = { org: context.org, playbook: context.playbook };
      yield* offered(toolsOf(routeOf(document.route ?? {})), ports, playbook);
      const read = yield* inputReadIn(ports, document, admitted, playbook);
      if (!asksLater(document)) {
        const notified = yield* requestOf(document, read);
        return { output: {}, record: notified };
      }
      yield* roomFor(ports, playbook);
      const record = yield* requestOf(document, read, yield* partOf(ports, playbook, document));
      const asking = { input: admitted, runId: context.id, functionName: context.definition.name };
      yield* checkedArguments(record, asking, ports.tools.mostRequestBytesTo);
      return { finishesLater: true, record };
    });
}
