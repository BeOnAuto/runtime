import { cancelRequestOf, type CancelRequested } from '@on.auto/definitions';
import type { PlaybookAddress, Conflict, Lineage, RecordedEvent } from '@on.auto/operations';
import type { RunInput, Submission } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import {
  callConsumerOf,
  DeliveryFailed,
  type CallConsumer,
  type CallRecord,
  type Delivery,
} from '../follower/consumers.ts';
import { runKeyOf } from '../runs/run-address.ts';
import { passedOverRow } from './pending-cancel-rows.ts';
import type { WaitingOptions } from './waiting-options.ts';

export interface CancelParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly cancelDeferred: WaitingOptions['cancelDeferred'];
  readonly workflows: string;
  readonly now: () => number;
}

interface Asked {
  readonly playbook: PlaybookAddress;
  readonly record: RecordedEvent;
  readonly request: CancelRequested;
}

interface AskedOfARun extends Asked {
  readonly type: string;
  readonly runId: string;
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

function lineageOf({ id, correlationId }: RecordedEvent): Lineage {
  return { causationId: id, correlationId };
}

function cancelledWorkflow(parts: CancelParts, { playbook, record, request, runId }: AskedOfARun) {
  const { kind, reason } = request.data;
  const { by } = request.context;
  const runKey = runKeyOf({ ...playbook, runId });
  const pending = { runKey, cause: record.id, cancel: { by, kind, reason } };
  return parts.submitted({ kind: 'cancel_requested', runId: runKey, at: parts.now(), ...pending }).pipe(
    Effect.flatMap(({ outcome }) => (outcome === 'not_started' ? passedOverRow(parts.database, pending) : Effect.void)),
    Effect.mapError(failedWith),
  );
}

function cancelled(parts: CancelParts, asked: AskedOfARun): Effect.Effect<void, DeliveryFailed> {
  const { playbook, record, request, type, runId } = asked;
  if (type === parts.workflows) {
    return cancelledWorkflow(parts, asked);
  }
  const { kind, reason } = request.data;
  const { by } = request.context;
  return parts
    .cancelDeferred({ ...playbook, id: runId }, { kind, reason, by }, lineageOf(record))
    .pipe(Effect.mapError(failedWith));
}

function askedOf({ playbook, record }: CallRecord): Asked | undefined {
  const request = cancelRequestOf(record);
  return request === undefined ? undefined : { playbook, record, request };
}

function deliveriesOf(parts: CancelParts, asked: Asked): readonly Delivery[] {
  const { record } = asked;
  const type = record.context.definitionType;
  if (type === undefined) {
    return [];
  }
  const runId = record.stream.slice(record.stream.lastIndexOf('/') + 1);
  const delivery: Delivery = {
    key: 'cancel',
    workflow: runId,
    deliver: cancelled(parts, { ...asked, type, runId }),
    skipped: () => Effect.void,
  };
  return [delivery];
}

export function cancelRequests(parts: CancelParts): CallConsumer {
  return callConsumerOf({
    name: 'cancel_requests',
    types: ['run_cancel_requested'],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    readOf: askedOf,
    batchOf: (asked, after) =>
      Effect.sync(() => ({
        deliveries: after === undefined ? deliveriesOf(parts, asked) : [],
        through: undefined,
        more: false,
      })),
  });
}
