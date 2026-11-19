import {
  isBoundedPart,
  type PlaybookAddress,
  type ProjectedKeyedRow,
  type ProjectionAdvancer,
  type ProjectionReader,
  type StreamWriter,
} from '@on.auto/operations';
import type { RecordedSubscription, SubscriptionKey, SubscriptionRecords } from '@on.auto/providers';
import { DateTime, Effect } from 'effect';

import {
  eventSubscriptionDecider,
  eventSubscriptionIdOf,
  eventSubscriptionStreamOf,
  type EventSubscriptionCommand,
} from './subscription-facts.ts';
import { eventSubscriptionsName, positionsAsColumns, recordedSubscriptionOf } from './subscription-rows.ts';

export interface SubscriptionLedger
  extends StreamWriter, Pick<ProjectionReader, 'readProjectedRows'>, ProjectionAdvancer {}

export const subscriptionsInAPage = 100;

const stillHeld = { column: 'removed', equals: false } as const;

function pageAfter(
  ledger: SubscriptionLedger,
  playbook: PlaybookAddress,
  after?: string,
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  return ledger.readProjectedRows(eventSubscriptionsName, playbook, {
    where: [stillHeld],
    orderBy: [],
    order: 'asc',
    limit: subscriptionsInAPage,
    ...(after === undefined ? {} : { after: [after] }),
  });
}

export function heldRowsOf(
  ledger: SubscriptionLedger,
  playbook: PlaybookAddress,
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  return Effect.gen(function* () {
    const held: ProjectedKeyedRow[] = [];
    let page = yield* pageAfter(ledger, playbook);
    held.push(...page);
    while (page.length === subscriptionsInAPage) {
      page = yield* pageAfter(ledger, playbook, page.at(-1)?.key);
      held.push(...page);
    }
    return held;
  });
}

function recordedBy(
  ledger: SubscriptionLedger,
  playbook: PlaybookAddress,
  commandAt: (at: string) => EventSubscriptionCommand,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const command = commandAt(DateTime.formatIso(yield* DateTime.now));
    yield* Effect.orDie(
      ledger.execute(eventSubscriptionStreamOf(playbook, command.key), eventSubscriptionDecider, command),
    );
  });
}

function readOf(ledger: SubscriptionLedger) {
  return (playbook: PlaybookAddress): Effect.Effect<readonly RecordedSubscription[]> =>
    Effect.map(heldRowsOf(ledger, playbook), (rows) => rows.map(({ row }) => recordedSubscriptionOf(row)));
}

function keyOf({ connection, topic }: SubscriptionKey): SubscriptionKey {
  return { connection, topic };
}

export function subscriptionRecordsOf(ledger: SubscriptionLedger): SubscriptionRecords {
  return {
    read: readOf(ledger),
    made: (playbook, key, made) => recordedBy(ledger, playbook, (at) => ({ kind: 'made', key: keyOf(key), made, at })),
    failed: (playbook, key, failed) =>
      recordedBy(ledger, playbook, (at) => ({ kind: 'failed', key: keyOf(key), failed, at })),
    removed: (playbook, key) => recordedBy(ledger, playbook, (at) => ({ kind: 'removed', key: keyOf(key), at })),
    moved: (playbook, key, positions) =>
      ledger.advanceRow(eventSubscriptionsName, playbook, eventSubscriptionIdOf(key), {
        set: positionsAsColumns(positions),
        when: [stillHeld],
      }),
    holds: isBoundedPart,
  };
}
