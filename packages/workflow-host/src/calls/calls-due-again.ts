import { attemptIsLive } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { DueItem, DueWork } from '../due-work/due-work.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { childStreamOf } from '../waiting/child-endings.ts';
import { dispatchedAgainRow, soonestDispatchAfter, waitingDispatchedBy, type WaitingCallOfARun } from './call-rows.ts';
import type { HostExecutor } from './host-executor.ts';

const noneDueAgain: readonly DueWork[] = [];

const nothingDue: readonly DueItem[] = [];

export function callsDueAgainOf(
  database: HostDatabase,
  executor: Pick<HostExecutor, 'dispatchedAgain'>,
  againAfterMs: number | undefined,
): readonly DueWork[] {
  if (againAfterMs === undefined) {
    return noneDueAgain;
  }
  const quietOf = ({ run, child }: WaitingCallOfARun) =>
    Effect.promise(() => database.store.ageOfLastAppend(childStreamOf(addressOfRun(run.runId), child)));
  const performed = (call: WaitingCallOfARun, at: number) =>
    Effect.flatMap(quietOf(call), (quietMs) =>
      attemptIsLive(quietMs, againAfterMs)
        ? dispatchedAgainRow(database, call.key, at - quietMs)
        : executor.dispatchedAgain(call, at),
    );
  const due = (now: number, most: number) =>
    Effect.map(waitingDispatchedBy(database, now - againAfterMs, most), (waiting) =>
      waiting.map((call): DueItem => ({ key: call.key, callsOut: true, perform: (at) => performed(call, at) })),
    );
  return [
    {
      name: 'waiting calls',
      due: (now, most, callsOut) => (callsOut ? due(now, most) : Effect.succeed(nothingDue)),
      nextDueAt: (after) =>
        Effect.map(soonestDispatchAfter(database, after - againAfterMs), (soonest) =>
          soonest === null ? null : soonest + againAfterMs,
        ),
    },
  ];
}
