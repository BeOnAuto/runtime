import { decisionLoop, type Decision, type DecisionLoop, type StreamAppend } from '@on.auto/ledger';
import { Data, Effect } from 'effect';

import { cachedLoadOf, keptAfter, runCacheOf, type RunCache } from '../cache/run-cache.ts';
import { runLogDeciderOf, type RunDecider, type RunLogRecord } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import type { LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore } from '../run-log/run-store.ts';
import { recordLineageOf } from './record-lineage.ts';

export type RunDecision = Decision<LoadedRun, RunState, RunLogEvent>;

export class SplitDecision extends Data.TaggedError('split_decision')<{
  readonly runId: string;
  readonly events: number;
}> {}

function appendOf(runStore: RunLogStore, cache: RunCache, input: RunInput): StreamAppend<RunLogRecord, LoadedRun> {
  return (runId, records, place, loaded) =>
    records.length > 1
      ? Effect.die(new SplitDecision({ runId, events: records.length }))
      : Effect.forEach(
          records,
          ({ data }) => runStore.append(runId, data, place, recordLineageOf(input, loaded.state, data)),
          { discard: true },
        ).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              cache.drop(runId);
            }),
          ),
        );
}

export function runLoopOf(
  runStore: RunLogStore,
  decider: RunDecider,
  cache: RunCache = runCacheOf(),
  reserve: Effect.Effect<void> = Effect.void,
): DecisionLoop<LoadedRun, RunState, RunInput, RunLogEvent, never> {
  const cached = cachedLoadOf(runStore, cache);
  const load = (runId: string): Effect.Effect<LoadedRun> => Effect.tap(cached(runId), () => reserve);
  const runLog = runLogDeciderOf(decider);
  return (runId, input) =>
    decisionLoop(
      load,
      appendOf(runStore, cache, input),
      runLog,
    )(runId, input).pipe(
      Effect.map((decided): RunDecision => ({ ...decided, events: decided.events.map(({ data }) => data) })),
      Effect.tap((decision) =>
        Effect.sync(() => {
          keptAfter(cache, runId, decision);
        }),
      ),
    );
}
