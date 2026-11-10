import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { DueItem, DueWork } from '../due-work/due-work.ts';
import { closableRuns, closedRun, closingBounds, soonestEndAfter, type EndOfARun } from './closed-runs.ts';

const nothingDue: readonly DueItem[] = [];

function closingOf(database: HostDatabase, end: EndOfARun): DueItem {
  return { key: end.runKey, callsOut: false, perform: (at) => closedRun(database, end, at) };
}

export function closingWorkOf(database: HostDatabase, quietMs: number = closingBounds.quietMs): DueWork {
  return {
    name: 'closed runs',
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.succeed(nothingDue)
        : Effect.map(closableRuns(database, now - quietMs, most), (ends) =>
            ends.map((end) => closingOf(database, end)),
          ),
    nextDueAt: (after, callsOut = false) =>
      callsOut
        ? Effect.succeed(null)
        : Effect.map(soonestEndAfter(database, after - quietMs), (soonest) =>
            soonest === null ? null : soonest + quietMs,
          ),
  };
}
