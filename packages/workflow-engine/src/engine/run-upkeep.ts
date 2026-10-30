import { Effect } from 'effect';

import type { RunCache } from '../cache/run-cache.ts';
import type { ArmTimer } from '../dispatch/run-output.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import { isSnapshotDue, sinceSnapshotAfter, snapshotOf } from '../run-log/snapshot.ts';
import type { EnginePorts } from './engine-ports.ts';
import type { RunDecision } from './run-loop.ts';

export function snapshotIfDue(
  ports: EnginePorts,
  cache: RunCache,
  runId: string,
  decision: RunDecision,
): Effect.Effect<void> {
  if (!isSnapshotDue(sinceSnapshotAfter(decision.loaded.sinceSnapshot, decision.events))) {
    return Effect.void;
  }
  cache.drop(runId);
  return ports.runStore.saveSnapshot(snapshotOf(decision.state, decision.version));
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

export function loadedFrom(ports: EnginePorts, runId: string): Effect.Effect<LoadedRun> {
  return Effect.map(ports.runStore.load(runId), (stored) => loadedRunOf(stored));
}
