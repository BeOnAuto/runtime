import { recordedRunIn, type Settlement } from '@on.auto/definitions';
import { Clock, Effect } from 'effect';

import { deliveredOnce } from '../delivery/attempt-delivery.ts';
import type { AttemptEnd } from '../delivery/attempt-end.ts';
import { endedFact, isLastAttempt, lostFact } from '../delivery/attempt-facts.ts';
import { isInteractionNotification, routeOfRow } from '../requests/request-rows.ts';
import { deliveringRecordOf } from '../run/request-record.ts';
import type { DeliveryParts, DueRequest } from './delivery-parts.ts';
import { deliveredSettlement, undeliveredSettlement } from './request-endings.ts';
import { recordedCall, settled } from './request-ledger.ts';

function settlementAfter({ row }: DueRequest, number: number, end: AttemptEnd, at: string): Settlement | undefined {
  if (!isInteractionNotification(row)) {
    return undefined;
  }
  if (end.type === 'delivery_succeeded') {
    return deliveredSettlement(at);
  }
  return isLastAttempt(end, number) ? undeliveredSettlement(routeOfRow(row)) : undefined;
}

interface Ended {
  readonly number: number;
  readonly end: AttemptEnd;
  readonly at: string;
}

function settledAfter(parts: DeliveryParts, request: DueRequest, { number, end, at }: Ended) {
  const settlement = settlementAfter(request, number, end, at);
  return settlement === undefined ? Effect.void : settled(parts.ledger, request.address, settlement, request.lineage);
}

export function lostAttempt(parts: DeliveryParts, { address, row, lineage }: DueRequest): Effect.Effect<void> {
  return Effect.asVoid(recordedCall(parts.record, address, lostFact(row), lineage));
}

export function nextAttempt(parts: DeliveryParts, request: DueRequest): Effect.Effect<void> {
  const { address, row, lineage } = request;
  return Effect.gen(function* () {
    const recorded = yield* recordedRunIn(parts.ledger, address);
    if (recorded?.awaitsSettlement !== true) {
      return;
    }
    const record = deliveringRecordOf(recorded.run.record);
    const { server, tool } = record.deliver;
    const attempting = { number: row.attempts + 1, target: row.party, server, tool };
    const began = yield* Clock.currentTimeMillis;
    const delivered = yield* deliveredOnce(parts, { request, record, input: recorded.input, attempting });
    if (delivered === undefined) {
      return;
    }
    const { number } = attempting;
    const ended = endedFact(number, delivered.end, (yield* Clock.currentTimeMillis) - began);
    const endedCall = yield* recordedCall(parts.record, address, ended, {
      ...lineage,
      causationId: delivered.startedId,
    });
    const settling = { ...request, lineage: { ...lineage, causationId: endedCall?.id ?? delivered.startedId } };
    const at = endedCall?.at ?? new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* settledAfter(parts, settling, { number, end: delivered.end, at });
  });
}
