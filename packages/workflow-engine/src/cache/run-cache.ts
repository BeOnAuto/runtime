import { Effect } from 'effect';

import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore } from '../run-log/run-store.ts';
import { sinceSnapshotAfter } from '../run-log/snapshot.ts';

export interface RunCacheBounds {
  readonly mostRuns: number;
  readonly mostBytes: number;
}

export interface RunCache {
  readonly get: (runId: string) => LoadedRun | undefined;
  readonly put: (runId: string, loaded: LoadedRun) => void;
  readonly drop: (runId: string) => void;
}

interface DecidedRun {
  readonly loaded: LoadedRun;
  readonly events: readonly RunLogEvent[];
  readonly state: RunState;
  readonly version: number;
}

export const runCacheBounds: RunCacheBounds = { mostRuns: 1024, mostBytes: 67_108_864 };

function bytesOf({ state }: LoadedRun): number {
  return state.heldBytes + state.inbox.waitingBytes;
}

export function runCacheOf({ mostRuns, mostBytes }: RunCacheBounds = runCacheBounds): RunCache {
  const runs = new Map<string, LoadedRun>();
  const held = { bytes: 0 };
  const drop = (runId: string): void => {
    const kept = runs.get(runId);
    if (kept !== undefined) {
      runs.delete(runId);
      held.bytes -= bytesOf(kept);
    }
  };
  const evictLeastRecentlyUsed = (): void => {
    for (const runId of runs.keys()) {
      if (runs.size <= mostRuns && held.bytes <= mostBytes) {
        return;
      }
      drop(runId);
    }
  };
  return {
    get: (runId) => {
      const kept = runs.get(runId);
      if (kept !== undefined) {
        runs.delete(runId);
        runs.set(runId, kept);
      }
      return kept;
    },
    put: (runId, loaded) => {
      drop(runId);
      runs.set(runId, loaded);
      held.bytes += bytesOf(loaded);
      evictLeastRecentlyUsed();
    },
    drop,
  };
}

function loadedFromStore(runStore: RunLogStore, cache: RunCache, runId: string): Effect.Effect<LoadedRun> {
  return Effect.map(runStore.load(runId), (stored) => {
    const loaded = loadedRunOf(stored);
    cache.put(runId, loaded);
    return loaded;
  });
}

export function cachedLoadOf(runStore: RunLogStore, cache: RunCache): (runId: string) => Effect.Effect<LoadedRun> {
  return (runId) => {
    const kept = cache.get(runId);
    if (kept === undefined) {
      return loadedFromStore(runStore, cache, runId);
    }
    return Effect.flatMap(runStore.eventsAfter(runId, kept.version), (newer) => {
      if (newer.length === 0) {
        return Effect.succeed(kept);
      }
      cache.drop(runId);
      return loadedFromStore(runStore, cache, runId);
    });
  };
}

export function keptAfter(cache: RunCache, runId: string, decided: DecidedRun): void {
  if (decided.events.length > 0) {
    const sinceSnapshot = sinceSnapshotAfter(decided.loaded.sinceSnapshot, decided.events);
    cache.put(runId, { state: decided.state, version: decided.version, sinceSnapshot });
  }
}
