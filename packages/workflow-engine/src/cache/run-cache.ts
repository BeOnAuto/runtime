import { Effect } from 'effect';

import { jsonBytesOf } from '../dsl/json.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore, StoredRun } from '../run-log/run-store.ts';
import { sinceSnapshotAfter } from '../run-log/snapshot.ts';
import type { RunReporter } from '../settlement/record-store.ts';

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

export const heapBytesPerJsonByte = 2;

interface KeptRun {
  readonly loaded: LoadedRun;
  readonly bytes: number;
}

function outcomeBytesOf({ outcome }: RunState): number {
  return outcome === null ? 0 : jsonBytesOf(outcome);
}

export function keptBytesOf({ state }: LoadedRun): number {
  return heapBytesPerJsonByte * (state.heldBytes + state.inbox.waitingBytes + outcomeBytesOf(state));
}

export function runCacheOf({ mostRuns, mostBytes }: RunCacheBounds = runCacheBounds): RunCache {
  const runs = new Map<string, KeptRun>();
  const held = { bytes: 0 };
  const drop = (runId: string): void => {
    const kept = runs.get(runId);
    if (kept !== undefined) {
      runs.delete(runId);
      held.bytes -= kept.bytes;
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
      return kept?.loaded;
    },
    put: (runId, loaded) => {
      drop(runId);
      const kept = { loaded, bytes: keptBytesOf(loaded) };
      runs.set(runId, kept);
      held.bytes += kept.bytes;
      evictLeastRecentlyUsed();
    },
    drop,
  };
}

export type ReportReloaded = RunReporter['reloaded'];

export const unreported: ReportReloaded = () => Effect.void;

function reportedOf(report: ReportReloaded, runId: string, stored: StoredRun, loaded: LoadedRun): Effect.Effect<void> {
  const { snapshot, tail } = stored;
  return snapshot === null && tail.length === 0
    ? Effect.void
    : report({ runId, snapshot: snapshot !== null, events: tail.length, keptBytes: keptBytesOf(loaded) });
}

function loadedFromStore({ runStore, cache, report }: CachedLoad, runId: string): Effect.Effect<LoadedRun> {
  return Effect.flatMap(runStore.load(runId), (stored) => {
    const loaded = loadedRunOf(stored);
    cache.put(runId, loaded);
    return Effect.as(reportedOf(report, runId, stored, loaded), loaded);
  });
}

export interface CachedLoad {
  readonly runStore: RunLogStore;
  readonly cache: RunCache;
  readonly report: ReportReloaded;
}

export function cachedLoadOf(load: CachedLoad): (runId: string) => Effect.Effect<LoadedRun> {
  const { runStore, cache } = load;
  return (runId) => {
    const kept = cache.get(runId);
    if (kept === undefined) {
      return loadedFromStore(load, runId);
    }
    return Effect.flatMap(runStore.eventsAfter(runId, kept.version), (newer) => {
      if (newer.length === 0) {
        return Effect.succeed(kept);
      }
      cache.drop(runId);
      return loadedFromStore(load, runId);
    });
  };
}

export function keptAfter(cache: RunCache, runId: string, decided: DecidedRun): void {
  if (decided.events.length > 0) {
    const sinceSnapshot = sinceSnapshotAfter(decided.loaded.sinceSnapshot, decided.events);
    cache.put(runId, { state: decided.state, version: decided.version, sinceSnapshot });
  }
}
