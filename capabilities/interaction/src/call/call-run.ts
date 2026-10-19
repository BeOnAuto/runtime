import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import type { Conflict, InvalidInput } from '@on.auto/operations';
import { toolBounds, type ToolAccess } from '@on.auto/tool-servers';
import { runIdKey } from '@on.auto/tool-servers/policy';
import { Clock, Effect, Result, type Schema } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';
import { unrenderableFor, unworkable } from '../run/request-rendering.ts';
import {
  argumentsFailureWords,
  momentVariables,
  renderedArguments,
  type ArgumentsFailure,
} from '../tool-blocks/rendered-arguments.ts';
import { endingOf } from './call-endings.ts';

export const longestCallRunMs = 4 * toolBounds.openMs + toolBounds.callMs;

export interface CallPorts {
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

function argumentsRejection(failure: ArgumentsFailure): Conflict | InvalidInput {
  if (failure.reason === 'too_large') {
    return unworkable('/call/with', argumentsFailureWords(failure, 'the call'));
  }
  const { argument, failure: rendering } = failure;
  return rendering.reason === 'not_text' || rendering.reason === 'too_long'
    ? unworkable(`/call/with/${argument}`, argumentsFailureWords(failure, 'the call'))
    : unrenderableFor(`The argument ${argument} of the call`, rendering);
}

function argumentsOf(
  { call }: CallDocument,
  variables: Readonly<Record<string, Schema.Json>>,
): Effect.Effect<Readonly<Record<string, Schema.Json>>, Conflict | InvalidInput> {
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(renderedArguments(call.with ?? {}, variables, clock), {
      onSuccess: ({ input }) => Effect.succeed(input),
      onFailure: (failure) => Effect.fail(argumentsRejection(failure)),
    }),
  );
}

export function callRun(ports: CallPorts) {
  return (
    document: CallDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* checkedInput(input, document.input.schema, functionResourceLabels.interaction.singular);
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const rendered = yield* argumentsOf(document, momentVariables(admitted, at));
      const { server, tool } = document.call;
      const called = yield* ports.tools.callOnce(
        {
          org: context.org,
          playbook: context.playbook,
          reference: { server, tool },
          input: rendered,
          meta: { [runIdKey]: context.id },
          longestRetryWaitMs: toolBounds.longestRetryWaitMs,
        },
        { callId: context.id, journal: context.journal },
      );
      return yield* endingOf(document, called);
    });
}
