import type { ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import {
  endsUndelivered,
  requestRowFrom,
  routeOfRow,
  settlementDueOf,
  type OpenRequestRow,
} from '../requests/request-rows.ts';
import type { DeliveryParts, DueRequest } from './delivery-parts.ts';
import { lostAttempt, nextAttempt } from './request-attempts.ts';
import { expiredSettlement, undeliveredSettlement } from './request-endings.ts';
import { correlationOf, settled, settledAnswered, settledDelivered } from './request-ledger.ts';

export interface DueRequestItem {
  readonly key: string;
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void>;
}

type DueAction =
  | 'settle_answered'
  | 'settle_delivered'
  | 'expire'
  | 'end_undelivered'
  | 'wait'
  | 'end_lost'
  | 'attempt';

function dueActionOf(row: OpenRequestRow, now: number): DueAction {
  const settling = settlementDueOf(row);
  if (settling !== undefined) {
    return settling;
  }
  if (now >= row.expires_at) {
    return 'expire';
  }
  if (endsUndelivered(row)) {
    return 'end_undelivered';
  }
  if (row.next_attempt_at === null || now < row.next_attempt_at) {
    return 'wait';
  }
  return row.standing === 'delivering' ? 'end_lost' : 'attempt';
}

export interface RequestsDue {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly DueRequestItem[]>;
  readonly nextDueAt: (after: number, callsOut?: boolean) => Effect.Effect<number | null>;
}

function performedNow(parts: DeliveryParts, request: DueRequest, now: number): Effect.Effect<void> {
  const { row, address, lineage } = request;
  const performed: Readonly<Record<DueAction, () => Effect.Effect<void>>> = {
    settle_answered: () => settledAnswered(parts.ledger, request),
    settle_delivered: () => settledDelivered(parts.ledger, request),
    expire: () => settled(parts.ledger, address, expiredSettlement(row), lineage),
    end_undelivered: () => settled(parts.ledger, address, undeliveredSettlement(routeOfRow(row)), lineage),
    wait: () => Effect.void,
    end_lost: () => lostAttempt(parts, request),
    attempt: () => nextAttempt(parts, request),
  };
  return performed[dueActionOf(row, now)]();
}

function performedRow(parts: DeliveryParts, kept: ProjectedKeyedRow, row: OpenRequestRow, now: number) {
  const address = { org: kept.org, playbook: kept.playbook, id: kept.key };
  return Effect.flatMap(correlationOf(parts.ledger, address), (correlationId) =>
    performedNow(parts, { address, row, lineage: { causationId: row.request_id, correlationId } }, now),
  );
}

function itemOf(parts: DeliveryParts, kept: ProjectedKeyedRow, dueAt: number): DueRequestItem {
  const row = requestRowFrom(kept.row);
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}`,
    callsOut: dueActionOf(row, dueAt) === 'attempt',
    perform: (now) => Effect.suspend(() => performedRow(parts, kept, row, now)),
  };
}

function dueColumnOf(callsOut: boolean): string {
  return callsOut ? 'attempt_due_at' : 'ending_due_at';
}

function dueColumnsOf(callsOut: boolean | undefined): readonly string[] {
  return callsOut === undefined ? [dueColumnOf(true), dueColumnOf(false)] : [dueColumnOf(callsOut)];
}

function soonestOf(times: readonly (number | null)[]): number | null {
  const set = times.filter((time) => time !== null);
  return set.length === 0 ? null : Math.min(...set);
}

export function requestsDue(parts: DeliveryParts): RequestsDue {
  return {
    name: 'the open requests of the playbook',
    due: (now, most, callsOut) =>
      Effect.map(
        parts.ledger.readDueRows(openRequestsName, {
          column: dueColumnOf(callsOut),
          through: now,
          limit: most,
        }),
        (rows) => rows.map((kept) => itemOf(parts, kept, now)),
      ),
    nextDueAt: (after, callsOut) =>
      Effect.map(
        Effect.forEach(dueColumnsOf(callsOut), (column) => parts.ledger.nextDueOf(openRequestsName, column, after)),
        soonestOf,
      ),
  };
}
