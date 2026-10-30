import { Effect } from 'effect';

import type { RunOutcome, RunState } from '../machine/run-state.ts';
import type { VirtualClock } from '../memory/virtual-clock.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import type { RunLogStore } from '../run-log/run-store.ts';

export interface RunWatch {
  readonly state: (runId: string) => RunState;
  readonly runUntilEnded: (runId: string) => RunState;
  readonly outcomeOf: (runId: string) => Promise<RunOutcome>;
}

const mostClockSteps = 10_000;

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function endless(runId: string, steps: number): Error {
  return new Error(`The run ${runId} did not end within ${steps} steps of its clock`);
}

function settledIn(events: readonly PositionedEvent[]): boolean {
  return events.some(({ event }) => event.outputs.some(({ kind }) => kind === 'settle'));
}

interface Watched {
  readonly version: number;
  readonly ended: boolean;
}

export function runWatchOf(runStore: RunLogStore, clock: VirtualClock, mostSteps = mostClockSteps): RunWatch {
  const state = (runId: string): RunState => loadedRunOf(Effect.runSync(runStore.load(runId))).state;
  const watched = new Map<string, Watched>();
  const hasEnded = (runId: string): boolean => {
    const seen = watched.get(runId) ?? { version: 0, ended: false };
    const events = Effect.runSync(runStore.eventsAfter(runId, seen.version));
    const now = { version: seen.version + events.length, ended: seen.ended || settledIn(events) };
    watched.set(runId, now);
    return now.ended;
  };
  const outcomeOf = async (runId: string): Promise<RunOutcome> => {
    await nextTurn();
    const { outcome } = hasEnded(runId) ? state(runId) : { outcome: null };
    if (outcome !== null) {
      return outcome;
    }
    if (!clock.advance()) {
      throw new Error(`The run ${runId} waits for something that never comes`);
    }
    return outcomeOf(runId);
  };
  return {
    state,
    runUntilEnded: (runId) => {
      for (let steps = 0; !hasEnded(runId) && clock.advance(); steps += 1) {
        if (steps === mostSteps) {
          throw endless(runId, mostSteps);
        }
      }
      return state(runId);
    },
    outcomeOf,
  };
}
