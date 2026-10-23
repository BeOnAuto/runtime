import { Effect } from 'effect';

import type { DueWork } from '../due-work/due-work.ts';
import type { WakeUpParts } from '../loop/host-wake-up.ts';
import type { WaitingOptions } from '../waiting/waiting-options.ts';
import { executorWaitingOf, servedWaitingOf, type ServedWaiting } from '../waiting/waiting-parts.ts';
import { hostEngineOn, type EngineOptions, type HostEngine } from './host-engine.ts';
import type { WorkflowStore } from './workflow-store.ts';

export interface PartsOptions extends EngineOptions {
  readonly sweepEveryMs: number;
  readonly waiting: WaitingOptions;
  readonly mostOpenCalls?: number;
  readonly dueWork?: readonly DueWork[];
}

export interface HostParts extends WakeUpParts, Pick<HostEngine, 'submitted' | 'reacting' | 'executor'> {
  readonly calls: ServedWaiting['calls'];
}

export function openHostParts(
  { database }: WorkflowStore,
  options: PartsOptions,
  armed: (dueAt: number) => void,
): HostParts {
  const { clock, reports } = options;
  const waiting = executorWaitingOf(database, options.machine, options.waiting, options.mostOpenCalls);
  const engine = hostEngineOn(database, options, waiting, armed);
  const served = servedWaitingOf({
    database,
    submitted: engine.submitted,
    resultOf: options.waiting.resultOf,
    cancelDeferred: options.waiting.cancelDeferred,
    workflows: options.reactions.definitionType,
    now: clock.now,
    trouble: reports.trouble,
  });
  return {
    clock,
    timers: engine.timers,
    dueWork: options.dueWork ?? [],
    engine: engine.engine,
    fire: ({ runKey, timerId }, at) =>
      Effect.andThen(
        served.endedChildren(runKey),
        engine.submitted({ kind: 'timer_fired', runId: runKey, at, timerId }),
      ),
    resume: () => Effect.andThen(served.cancelsAsked, engine.executor.resume()),
    trouble: reports.trouble,
    sweepEveryMs: options.sweepEveryMs,
    context: options.context,
    submitted: engine.submitted,
    reacting: engine.reacting,
    executor: engine.executor,
    calls: served.calls,
  };
}

export function closeHostParts({ executor }: HostParts): Promise<void> {
  return Effect.runPromise(executor.stop());
}
