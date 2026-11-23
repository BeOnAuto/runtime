import { addressOfTheRow, type PlaybookAddress, type ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { heldRowsOf, type SubscriptionLedger } from './subscription-records.ts';
import { eventSubscriptionsName, reconcileDueColumn, recordedSubscriptionOf } from './subscription-rows.ts';

interface WokenChecks {
  readonly org: string;
  readonly playbook?: string;
  readonly connection: string;
}

function dueLaterIn({ row }: ProjectedKeyedRow, connection: string, now: number): number | undefined {
  const recorded = recordedSubscriptionOf(row);
  const { made, positions } = recorded;
  const dueAt = positions?.dueAt;
  const checkedAndWaiting = made?.type === 'polling' && positions?.failures === 0;
  return recorded.connection === connection && checkedAndWaiting && dueAt !== undefined && dueAt > now
    ? dueAt
    : undefined;
}

function broughtForward(ledger: SubscriptionLedger, kept: ProjectedKeyedRow, dueAt: number, now: number) {
  return ledger.advanceRow(eventSubscriptionsName, addressOfTheRow(kept), kept.key, {
    set: { due_at: now, [reconcileDueColumn]: now },
    when: [
      { column: 'removed', equals: false },
      { column: 'due_at', equals: dueAt },
    ],
  });
}

function checksOf(ledger: SubscriptionLedger, playbook: PlaybookAddress, connection: string, now: number) {
  return Effect.flatMap(heldRowsOf(ledger, playbook), (rows) =>
    Effect.forEach(
      rows,
      (kept) => {
        const dueAt = dueLaterIn(kept, connection, now);
        return dueAt === undefined ? Effect.void : broughtForward(ledger, kept, dueAt, now);
      },
      { discard: true },
    ),
  );
}

export function checksWokenOf(ledger: SubscriptionLedger): (woken: WokenChecks, now: number) => Effect.Effect<void> {
  return ({ org, playbook, connection }, now) =>
    playbook === undefined ? Effect.void : checksOf(ledger, { org, playbook }, connection, now);
}
