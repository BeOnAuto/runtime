import type { MachineOptions } from '@on.auto/workflow-engine';
import type { Cause, Effect } from 'effect';

import type { ExecutorParts } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import type { CallConsumer, DeliveryFailed } from '../follower/consumers.ts';
import { cancelRequests, type CancelParts } from './cancel-requests.ts';
import { childCancelsOn } from './child-cancels.ts';
import { childAnswersOn, childEndings, endedChildrenOn, type EndingParts } from './child-endings.ts';
import { pendingCancelsGivenOnce } from './pending-cancels.ts';
import { mostOpenCallsOfATree, type WaitingOptions } from './waiting-options.ts';

export type ExecutorWaiting = Pick<ExecutorParts, 'mostOpen' | 'childOf' | 'childAnswerOf' | 'cancelChild'>;

export function executorWaitingOf(
  database: HostDatabase,
  machine: MachineOptions,
  waiting: WaitingOptions,
  mostOpen: number = mostOpenCallsOfATree,
): ExecutorWaiting {
  return {
    mostOpen,
    childAnswerOf: childAnswersOn(database, waiting.resultOf),
    childOf: (call, run) =>
      machine.functions.childOf?.({
        function: call.function,
        reference: call.key.reference,
        run: call.key.run,
        arguments: call.arguments,
        attributes: run.attributes,
      }) ?? null,
    cancelChild: childCancelsOn(waiting.cancel),
  };
}

export interface CallConsumerParts extends EndingParts, CancelParts {
  readonly trouble: (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}

export interface ServedWaiting {
  readonly calls: readonly CallConsumer[];
  readonly endedChildren: (runKey: string) => Effect.Effect<void, DeliveryFailed>;
  readonly cancelsAsked: Effect.Effect<void>;
}

export function servedWaitingOf(parts: CallConsumerParts): ServedWaiting {
  return {
    calls: [childEndings(parts), cancelRequests(parts)],
    endedChildren: endedChildrenOn(parts),
    cancelsAsked: pendingCancelsGivenOnce(parts, parts.trouble),
  };
}
