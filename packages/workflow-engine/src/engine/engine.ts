import { Effect } from 'effect';

import { runCacheOf, type RunCache } from '../cache/run-cache.ts';
import { workflowMachine } from '../decider/workflow-machine.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { runStoresOf, type EnginePorts } from './engine-ports.ts';
import { runDispatchOf } from './run-dispatch.ts';
import { runLoopOf, type RunLoopUpkeep } from './run-loop.ts';
import { armedTimersOf, snapshotIfDue } from './run-upkeep.ts';
import { submissionWithDeclined } from './submission.ts';
import type { Wake, WorkflowEngine } from './workflow-engine.ts';

const mostBehindRunsInOneSweep = 1024;

function dueRunsOf<Unavailable>(ports: EnginePorts<Unavailable>, before: number): Effect.Effect<readonly string[]> {
  return Effect.zipWith(
    ports.recordStore.dueRuns(before),
    ports.watermark.behindRuns(mostBehindRunsInOneSweep),
    (dueByTime, behind) => [...new Set([...dueByTime, ...behind])],
  );
}

function upkeepOf<Unavailable>(ports: EnginePorts<Unavailable>, options: MachineOptions): RunLoopUpkeep {
  return { reserve: options.sandbox.reserve, report: (reloaded) => ports.reporter.reloaded(reloaded) };
}

export function workflowEngineOf<Unavailable = never>(
  ports: EnginePorts<Unavailable>,
  options: MachineOptions,
  cache: RunCache = runCacheOf(),
): WorkflowEngine<Unavailable> {
  const loop = runLoopOf(runStoresOf(ports), workflowMachine(options), cache, upkeepOf(ports, options));
  const dispatch = runDispatchOf(ports);
  const wake = (runId: string): Effect.Effect<Wake> =>
    ports.serialiser.serialise(
      runId,
      Effect.map(dispatch.stored(runId), ({ wake: woken }) => woken),
    );
  const swept = (runId: string): Effect.Effect<number> =>
    ports.serialiser.serialise(
      runId,
      Effect.gen(function* () {
        const { state } = yield* dispatch.stored(runId);
        const run = { runId, attributes: state.attributes };
        return yield* Effect.orElseSucceed(ports.timers.sweep(run, armedTimersOf(runId, state)), () => 0);
      }),
    );
  return {
    submit: (input) =>
      ports.serialiser.serialise(
        input.runId,
        Effect.gen(function* () {
          const decision = yield* loop(input.runId, input);
          if (decision.events.length > 0) {
            yield* snapshotIfDue(ports.runStore, cache, input.runId, decision);
            yield* dispatch.decided(input.runId, decision);
          }
          return yield* submissionWithDeclined(decision, input, options);
        }),
      ),
    wake,
    sweep: (before) =>
      Effect.gen(function* () {
        const due = yield* dueRunsOf(ports, before);
        const armedAgain = yield* Effect.forEach(due, (runId) => swept(runId));
        return { runs: due.length, timersArmedAgain: armedAgain.reduce((sum, count) => sum + count, 0) };
      }),
  };
}
