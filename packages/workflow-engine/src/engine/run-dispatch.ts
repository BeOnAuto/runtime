import { Effect } from 'effect';

import type { CachedRun, RunCache } from '../cache/run-cache.ts';
import { contentsAtHandAfter, contentsCachedIn } from '../cache/run-contents.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunDecision } from './decided-append.ts';
import { runStoresOf, type EnginePorts } from './engine-ports.ts';
import { dispatchRun, type LoadedForDispatch } from './output-dispatch.ts';
import { callsPerformedWith } from './performed-calls.ts';
import { loadedFrom } from './run-upkeep.ts';
import type { Wake } from './workflow-engine.ts';

interface StoredDispatch {
  readonly state: RunState;
  readonly wake: Wake;
}

interface RunDispatch {
  readonly decided: (runId: string, decision: RunDecision) => Effect.Effect<Wake>;
  readonly stored: (runId: string) => Effect.Effect<StoredDispatch>;
}

export function runDispatchOf<Unavailable>(ports: EnginePorts<Unavailable>, cache: RunCache): RunDispatch {
  const { payloads } = runStoresOf(ports);
  const contentsCachedFor = contentsCachedIn(cache);
  const dispatched = (loaded: LoadedForDispatch, contents: CachedRun['contents']) =>
    dispatchRun(ports, loaded, callsPerformedWith({ runId: loaded.runId, payloads, contents }));
  return {
    decided: (runId, decision) =>
      dispatched({ runId, state: decision.state, version: decision.version }, contentsAtHandAfter(decision)),
    stored: (runId) =>
      Effect.flatMap(loadedFrom(ports.runStore, runId), ({ state, version }) =>
        Effect.map(dispatched({ runId, state, version }, contentsCachedFor(runId)), (wake) => ({ state, wake })),
      ),
  };
}
