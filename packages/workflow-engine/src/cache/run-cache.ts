import { Effect } from 'effect';

import { jsonBytesOf } from '../dsl/json.ts';
import { isKept, type HeldContent, type HeldContents } from '../machine/held-contents.ts';
import type { KeptValue } from '../machine/held-value.ts';
import { heldValueOf, reachableValueIds } from '../machine/held-values.ts';
import type { RunState } from '../machine/run-state.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore, StoredRun } from '../run-log/run-store.ts';
import { stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import type { RunReporter } from '../settlement/record-store.ts';

export interface RunCacheBounds {
  readonly mostRuns: number;
  readonly mostBytes: number;
}

export interface CachedRun extends LoadedRun {
  readonly contents: HeldContents;
}

export interface RunCache {
  readonly get: (runId: string) => CachedRun | undefined;
  readonly put: (runId: string, run: CachedRun) => void;
  readonly drop: (runId: string) => void;
}

export const runCacheBounds: RunCacheBounds = { mostRuns: 1024, mostBytes: 67_108_864 };

export const heapBytesPerJsonByte = 2;

export const mostHeapBytesPerCharacter = 2;

interface KeptRun {
  readonly loaded: CachedRun;
  readonly bytes: number;
}

function outcomeBytesOf({ outcome }: RunState): number {
  return outcome === null ? 0 : jsonBytesOf(outcome);
}

function keptValuesHeldIn(state: RunState): readonly KeptValue[] {
  return reachableValueIds(state)
    .map((id) => heldValueOf(state, id))
    .filter((held) => isKept(held));
}

function pointerBytesOf({ sha256, bytes }: KeptValue): number {
  return jsonBytesOf({ sha256, bytes });
}

function dataBytesOf(state: RunState, kept: readonly KeptValue[]): number {
  const held = kept.reduce((bytes, value) => bytes - value.bytes + pointerBytesOf(value), state.heldBytes);
  return held + state.inbox.waitingBytes + outcomeBytesOf(state);
}

function textHeapBytesOf(text: string, utf8Bytes: number | undefined): number {
  return utf8Bytes === text.length ? text.length : mostHeapBytesPerCharacter * text.length;
}

function textsReadInBytesOf(contents: HeldContents, kept: readonly KeptValue[]): number {
  const sizes = new Map(kept.map(({ sha256, bytes }) => [sha256, bytes]));
  return [...contents].reduce(
    (sum, [sha256, content]: readonly [string, HeldContent]) =>
      content.kind === 'read' ? sum + textHeapBytesOf(content.text, sizes.get(sha256)) : sum,
    0,
  );
}

function mayHoldKeptValues({ format }: LoadedRun): boolean {
  return format !== null && format >= stateFormatKeepingPayloads;
}

export function keptBytesOf(run: CachedRun): number {
  const { state, contents } = run;
  const kept = mayHoldKeptValues(run) ? keptValuesHeldIn(state) : [];
  return heapBytesPerJsonByte * dataBytesOf(state, kept) + textsReadInBytesOf(contents, kept);
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

function reportedOf(report: ReportReloaded, runId: string, stored: StoredRun, loaded: CachedRun): Effect.Effect<void> {
  const { snapshot, tail } = stored;
  return snapshot === null && tail.length === 0
    ? Effect.void
    : report({ runId, snapshot: snapshot !== null, events: tail.length, keptBytes: keptBytesOf(loaded) });
}

function loadedFromStore({ runStore, cache, report }: CachedLoad, runId: string): Effect.Effect<CachedRun> {
  return Effect.flatMap(runStore.load(runId), (stored) => {
    const loaded = { ...loadedRunOf(stored), contents: new Map<string, HeldContent>() };
    cache.put(runId, loaded);
    return Effect.as(reportedOf(report, runId, stored, loaded), loaded);
  });
}

export interface CachedLoad {
  readonly runStore: RunLogStore;
  readonly cache: RunCache;
  readonly report: ReportReloaded;
}

export function cachedLoadOf(load: CachedLoad): (runId: string) => Effect.Effect<CachedRun> {
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
