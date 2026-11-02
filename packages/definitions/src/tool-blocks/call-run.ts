import { toolBounds, type ToolAccess } from '@on.auto/tool-servers';
import { runIdKey } from '@on.auto/tool-servers/policy';
import { Clock, Effect, type Schema } from 'effect';

import type { CapabilityAnswer, CapabilityRejection } from '../capability/capability.ts';
import type { RunContext } from '../capability/run-context.ts';
import { checkedInput } from '../checking/schema-refusals.ts';
import type { ValueContract } from '../document/function-fields.ts';
import { callArgumentsOf } from './call-arguments.ts';
import { callEndingOf, type CalledDocument } from './call-endings.ts';
import { momentVariables } from './rendered-arguments.ts';

export const longestCallRunMs = 4 * toolBounds.openMs + toolBounds.callMs;

export interface CallPorts {
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

export interface CallingDocument extends CalledDocument {
  readonly input: ValueContract;
}

export interface CallRunning {
  readonly noun: string;
  readonly requiredMark?: 'reads';
}

export function callRunOf(ports: CallPorts, { noun, requiredMark }: CallRunning) {
  return (
    document: CallingDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* checkedInput(input, document.input.schema, noun);
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const rendered = yield* callArgumentsOf(document.call, momentVariables(admitted, at));
      const { server, tool } = document.call;
      const called = yield* ports.tools.callOnce(
        {
          org: context.org,
          playbook: context.playbook,
          reference: { server, tool },
          input: rendered,
          meta: { [runIdKey]: context.id },
          longestRetryWaitMs: toolBounds.longestRetryWaitMs,
          ...(requiredMark === undefined ? {} : { requiredMark }),
        },
        { callId: context.id, journal: context.journal },
      );
      return yield* callEndingOf(document, called);
    });
}
