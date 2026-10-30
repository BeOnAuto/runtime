import type { CallResult } from '@on.auto/operations';
import { callKeyText, type CallKey } from '@on.auto/workflow-engine';
import type { ExecutorSubject } from '@on.auto/workflow-engine/testing';
import { Deferred, Effect, Function } from 'effect';

import { hostExecutor, type HostExecutor } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { runKey } from './probe-subjects.ts';

export function executorSubjectOn(database: HostDatabase): ExecutorSubject {
  const finishers = new Map<string, Deferred.Deferred<CallResult>>();
  const answered: string[] = [];
  const finisherOf = (key: CallKey): Deferred.Deferred<CallResult> => {
    const finisher = finishers.get(callKeyText(key)) ?? Deferred.makeUnsafe<CallResult>();
    finishers.set(callKeyText(key), finisher);
    return finisher;
  };
  const executorNow = (): HostExecutor =>
    hostExecutor({
      now: Date.now,
      database,
      perform: (call) => Deferred.await(finisherOf(call.key)),
      deliver: (key) =>
        Effect.sync(() => {
          answered.push(callKeyText(key));
        }),
      trouble: Effect.logWarning,
      mostAtOnce: 4,
      mostOpen: 1000,
      childOf: (call) => callKeyText(call.key),
      childAnswerOf: Function.constant(Effect.undefined),
      cancelChild: () => Effect.succeed('requested'),
    });
  const host = { current: executorNow() };
  return {
    executor: {
      start: (call, run, origin) => host.current.executor.start(call, run, origin),
      cancel: (call, run, origin) => host.current.executor.cancel(call, run, origin),
    },
    run: { runId: runKey, attributes: {} },
    finish: (call, result) => Deferred.succeed(finisherOf(call.key), result),
    loseHost: () =>
      Effect.andThen(
        host.current.stop(),
        Effect.sync(() => {
          host.current = executorNow();
        }),
      ),
    settle: () =>
      Effect.andThen(
        host.current.idle(),
        Effect.sync(() => answered.splice(0)),
      ),
  };
}
