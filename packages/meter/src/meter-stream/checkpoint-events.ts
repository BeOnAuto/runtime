import { digestOf } from '../counting/checkpoint-digest.ts';
import type { Counting } from '../counting/run-starts.ts';
import type { DecidedEvent } from './meter-commands.ts';
import type { MeterState } from './meter-events.ts';

interface Settled {
  readonly started: readonly string[];
  readonly lapsed: readonly string[];
}

export function heldAfter(state: MeterState, counting: Counting, at: string): MeterState['holds'] {
  return state.holds.filter(({ run, until }) => !counting.hasStarted(run) && until > at);
}

function settledHolds(state: MeterState, counting: Counting, at: string): Settled {
  return {
    started: state.holds.filter(({ run }) => counting.hasStarted(run)).map(({ run }) => run),
    lapsed: state.holds.filter(({ run, until }) => !counting.hasStarted(run) && until <= at).map(({ run }) => run),
  };
}

function movesTheCount(kept: MeterState['checkpoint'], counting: Counting, { started, lapsed }: Settled): boolean {
  const keptActions = kept?.actions ?? 0;
  const moved = kept?.last !== counting.last || keptActions !== counting.actions;
  return counting.actions >= keptActions && (moved || started.length + lapsed.length > 0);
}

function checkpointEvents({ through, last, actions }: Counting, settled: Settled): readonly DecidedEvent[] {
  return through === undefined || last === undefined
    ? []
    : [
        {
          type: 'actions_counted',
          data: { actions, through, last, digest: digestOf({ actions, through, last }), ...settled },
        },
      ];
}

export function countedEvents(state: MeterState, counting: Counting, at: string): readonly DecidedEvent[] {
  const settled = settledHolds(state, counting, at);
  const events = checkpointEvents(counting, settled);
  return movesTheCount(state.checkpoint, counting, settled) ? events : [];
}

export function rebuiltEvents(state: MeterState, counting: Counting, at: string): readonly DecidedEvent[] {
  return checkpointEvents(counting, settledHolds(state, counting, at));
}
