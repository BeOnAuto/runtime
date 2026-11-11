import { Effect } from 'effect';

import type { RunCache } from '../cache/run-cache.ts';
import type { ArmTimer } from '../dispatch/run-output.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore } from '../run-log/run-store.ts';
import { isSnapshotDue, sinceSnapshotAfter, snapshotBytesOf, snapshotOf, type Snapshot } from '../run-log/snapshot.ts';
import type { RunDecision } from './decided-append.ts';

export function snapshotIfDue(
  runStore: RunLogStore,
  cache: RunCache,
  runId: string,
  decision: RunDecision,
): Effect.Effect<void> {
  if (!isSnapshotDue(sinceSnapshotAfter(decision.loaded.sinceSnapshot, decision.events))) {
    return Effect.void;
  }
  const snapshot = snapshotOf(decision.state, decision.version, decision.format);
  return Effect.andThen(
    runStore.saveSnapshot(snapshot),
    Effect.sync(() => {
      keptSinceItsSnapshot(cache, runId, snapshot);
    }),
  );
}

function keptSinceItsSnapshot(cache: RunCache, runId: string, snapshot: Snapshot): void {
  const cached = cache.get(runId);
  if (cached?.version === snapshot.version) {
    cache.put(runId, { ...cached, sinceSnapshot: { bytes: 0, snapshotBytes: snapshotBytesOf(snapshot) } });
  }
}

export function armedTimersOf(runId: string, state: RunState): readonly ArmTimer[] {
  return Object.entries(state.timers.armed).map(([timerId, { dueAt, purpose }]: readonly [string, ArmedTimer]) => ({
    kind: 'arm_timer',
    runId,
    timerId,
    dueAt,
    purpose,
  }));
}

export function loadedFrom(runStore: RunLogStore, runId: string): Effect.Effect<LoadedRun> {
  return Effect.map(runStore.load(runId), (stored) => loadedRunOf(stored));
}
