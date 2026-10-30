import type { Lineage } from '@on.auto/operations';
import {
  callKeyText,
  type CallCancelReceipt,
  type CancelCall,
  type CancelReason,
  type OutputOrigin,
  type RunContext,
} from '@on.auto/workflow-engine';
import { Data, Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { addressOfRun, type RunAddress } from '../runs/run-address.ts';
import { lineageOfSettlement } from '../runs/run-lineage.ts';
import { callRowOf, cancelledRow, tombstonedRow, type CallRow } from './call-rows.ts';

export interface ChildCancel {
  readonly child: RunAddress;
  readonly reason: CancelReason;
  readonly lineage: Lineage;
}

export type ChildReceipt = 'requested' | 'ended' | 'unknown_run';

export type CancelChild = (cancel: ChildCancel) => Effect.Effect<ChildReceipt, Readonly<{ detail: string }>>;

export class ChildNotCancelled extends Data.TaggedError('child_not_cancelled')<{ readonly detail: string }> {}

const childNotInItsPlaybook = new ChildNotCancelled({
  detail: 'The run this call waits for has an address its playbook cannot hold, so it could not be cancelled',
});

export interface CancelParts {
  readonly database: HostDatabase;
  readonly cancelChild: CancelChild;
  readonly interrupt: (key: string) => Effect.Effect<void>;
}

export interface Cancelling {
  readonly call: CancelCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
}

function childCancelled(
  { cancelChild }: CancelParts,
  child: string | null,
  { call, run, origin }: Cancelling,
): Effect.Effect<void, ChildNotCancelled> {
  if (child === null) {
    return Effect.void;
  }
  const { org, playbook } = addressOfRun(run.runId);
  return cancelChild({
    child: { org, playbook, runId: child },
    reason: call.reason ?? 'parent_ended',
    lineage: lineageOfSettlement(run, origin),
  }).pipe(
    Effect.mapError(({ detail }) => new ChildNotCancelled({ detail })),
    Effect.flatMap((receipt) => (receipt === 'unknown_run' ? Effect.fail(childNotInItsPlaybook) : Effect.void)),
  );
}

function cancelledAs(
  parts: CancelParts,
  row: CallRow,
  cancelling: Cancelling,
): Effect.Effect<CallCancelReceipt, DatabaseFailed | ChildNotCancelled> {
  const key = callKeyText(cancelling.call.key);
  return Effect.gen(function* () {
    if (row.state === 'answered') {
      return 'already_answered';
    }
    yield* childCancelled(parts, row.child, cancelling);
    if (row.state !== 'cancelled') {
      yield* cancelledRow(parts.database, key);
    }
    if (row.state === 'running') {
      yield* parts.interrupt(key);
    }
    return 'cancelled';
  });
}

export function cancelledCall(
  parts: CancelParts,
  cancelling: Cancelling,
): Effect.Effect<CallCancelReceipt, DatabaseFailed | ChildNotCancelled> {
  return Effect.gen(function* () {
    const key = callKeyText(cancelling.call.key);
    const row = yield* callRowOf(parts.database, key);
    if (row !== undefined) {
      return yield* cancelledAs(parts, row, cancelling);
    }
    yield* tombstonedRow(parts.database, key, cancelling.run.runId);
    return 'tombstoned';
  });
}
