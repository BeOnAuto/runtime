import {
  playbookCallerOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Lineage,
  type NotFound,
  type Settlement,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import { Effect, Equal } from 'effect';

import { cancelledAsAsked, type CancelledRun, type Capability } from '../capability/capability.ts';
import { isChangedSinceRead, runDeciderAsRead, runStreamNameOf } from '../runs/run-decider.ts';
import { endedWithAnotherResult } from '../runs/run-decisions.ts';
import { runSettlerAsRead, type RunStreamAddress } from '../runs/run-settler.ts';
import { startedRunOf, takesSettlement } from '../runs/run-state.ts';
import type { CancelRequest } from './run-cancels.ts';

export type SettleCancelled = (
  run: RunStreamAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<void, NotFound | Conflict>;

const brokeDown: Settlement = { status: 'failed' };

const readsAgainAtMost = 3;

function endedOtherwise(error: unknown): boolean {
  return Equal.equals(error, endedWithAnotherResult);
}

function decided(capability: Capability | undefined, run: CancelledRun): Effect.Effect<Settlement> {
  const cancel = capability?.cancel ?? cancelledAsAsked;
  return Effect.try({ try: () => cancel(run), catch: () => brokeDown }).pipe(Effect.orElseSucceed(() => brokeDown));
}

export function deferredCanceller(
  capabilities: readonly Capability[],
  ledger: StreamReader & StreamWriter,
): SettleCancelled {
  const settle = runSettlerAsRead(ledger);
  const settledAsRead: SettleCancelled = (run, { kind, reason, by }, lineage) =>
    Effect.gen(function* () {
      const stream = `${streamPrefixOfPlaybook(run)}${runStreamNameOf(run.id.toLowerCase())}`;
      const read = (yield* ledger.load(stream, runDeciderAsRead)).state;
      const state = startedRunOf(read.state);
      if (state === undefined || !takesSettlement(state)) {
        return;
      }
      const capability = capabilities.find(({ type }) => type === state.run.type);
      const settlement = yield* decided(capability, {
        run,
        record: state.record ?? {},
        kind,
        reason,
        answer: state.answer,
        work: state.work,
      });
      const actor = settlement.by ?? by ?? playbookCallerOf(run).id;
      yield* settle(run, { ...settlement, by: actor }, read.version, lineage).pipe(
        Effect.asVoid,
        Effect.catchIf(endedOtherwise, () => Effect.void),
      );
    });
  return (run, request, lineage) =>
    settledAsRead(run, request, lineage).pipe(Effect.retry({ times: readsAgainAtMost, while: isChangedSinceRead }));
}
