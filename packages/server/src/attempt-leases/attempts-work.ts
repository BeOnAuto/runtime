import type { CancelRun, LookAgain } from '@on.auto/definitions';
import { goneHoldersWork, type DueItem, type DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { callersByIdIn, type AttemptHolding, type CallersAccess, type ProcessStopping } from './attempt-holding.ts';
import { cancelsAgainOf } from './cancels-again.ts';
import { goneHoldersOn, type GoneHolderParts } from './gone-holders.ts';

interface AttemptsWork {
  readonly lookAgain: LookAgain;
  readonly dueWorkOf: (cancel: CancelRun) => readonly DueWork[];
}

interface AttemptsWorkParts extends Omit<GoneHolderParts, 'callers' | 'holding'> {
  readonly holding: AttemptHolding;
  readonly access: CallersAccess;
  readonly now: () => number;
}

const nothingTakenUp: readonly DueItem[] = [];

function takenUpUntilItsProcessStops(work: DueWork, stopping: ProcessStopping): DueWork {
  const unlessStopped = (item: DueItem): DueItem => ({
    ...item,
    perform: (at) => Effect.suspend(() => (stopping.underway() ? Effect.void : item.perform(at))),
  });
  return {
    name: work.name,
    due: (now, most, callsOut) =>
      Effect.suspend(() =>
        stopping.underway()
          ? Effect.succeed(nothingTakenUp)
          : Effect.map(work.due(now, most, callsOut), (items) => items.map((item) => unlessStopped(item))),
      ),
    nextDueAt: (after, callsOut) =>
      Effect.suspend(() => (stopping.underway() ? Effect.succeed(null) : work.nextDueAt(after, callsOut))),
  };
}

export function attemptsWorkOf({ access, now, ...parts }: AttemptsWorkParts): AttemptsWork {
  const { store, holding } = parts;
  const cancelsAgain = cancelsAgainOf(now);
  const gone = takenUpUntilItsProcessStops(
    goneHoldersWork(store.database, holding, goneHoldersOn({ ...parts, callers: callersByIdIn(access) })),
    holding.stopping,
  );
  return { lookAgain: cancelsAgain.lookAgain, dueWorkOf: (cancel) => [gone, cancelsAgain.workOf(cancel)] };
}
