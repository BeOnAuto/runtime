import { addressOfTheRow, playbookRowsOf, type PlaybookAddress, type ProjectionReader } from '@on.auto/operations';
import { resyncedAfterMs } from '@on.auto/providers';
import { Effect, Schema } from 'effect';

import { heldRowsOf, type SubscriptionLedger } from './subscription-records.ts';
import { eventSubscriptionsName, reconcileDueColumn } from './subscription-rows.ts';

export type DueLedger = Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'>;

export function playbooksDueOf(
  ledger: DueLedger,
  now: number,
  most: number,
): Effect.Effect<readonly PlaybookAddress[]> {
  const due = { column: reconcileDueColumn, through: now, limit: most, onePerPlaybook: true };
  return Effect.map(ledger.readDueRows(eventSubscriptionsName, due), (rows) =>
    playbookRowsOf(eventSubscriptionsName, rows).map(({ org, playbook }): PlaybookAddress => ({ org, playbook })),
  );
}

export function holdsASubscription(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
): Effect.Effect<boolean> {
  return Effect.map(
    ledger.readProjectedRows(eventSubscriptionsName, playbook, {
      where: [{ column: 'removed', equals: false }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    (rows) => rows.length > 0,
  );
}

export function reconcileDueAfter(ledger: DueLedger, after: number): Effect.Effect<number | null> {
  return ledger.nextDueOf(eventSubscriptionsName, reconcileDueColumn, after);
}

const readDue = Schema.decodeUnknownSync(Schema.Struct({ [reconcileDueColumn]: Schema.NullOr(Schema.Int) }));

export function reconcileDueSet(
  ledger: SubscriptionLedger,
  playbook: PlaybookAddress,
  now: number,
  dueAt?: number,
): Effect.Effect<void> {
  const due = Math.min(dueAt ?? Number.POSITIVE_INFINITY, now + resyncedAfterMs);
  return Effect.flatMap(heldRowsOf(ledger, playbook), (rows) =>
    Effect.forEach(
      rows.filter(({ row }) => readDue(row)[reconcileDueColumn] !== due),
      (kept) =>
        ledger.advanceRow(eventSubscriptionsName, addressOfTheRow(kept), kept.key, {
          set: { [reconcileDueColumn]: due },
          when: [{ column: 'removed', equals: false }],
        }),
      { discard: true },
    ),
  );
}
