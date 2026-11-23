import {
  isBoundedPart,
  rowKeyColumn,
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
  eventSubscriptionReadDecider,
  eventSubscriptionReadStreamOf,
  eventSubscriptionStreamOf,
  type EventSubscriptionCommand,
} from './subscription-facts.ts';
import {
  eventSubscriptionsName,
  markAsColumns,
  positionsAsColumns,
  recordedSubscriptionOf,
} from './subscription-rows.ts';

export interface SubscriptionLedger
  extends StreamWriter, Pick<ProjectionReader, 'readProjectedRows'>, ProjectionAdvancer {}

export const subscriptionsInAPage = 100;

const stillHeld = { column: 'removed', equals: false } as const;

type HeldRowsReader = Pick<ProjectionReader, 'readProjectedRows'>;

function pageAfter(
  ledger: HeldRowsReader,
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
  ledger: HeldRowsReader,
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

export function recordedSubscriptionAt(
  ledger: HeldRowsReader,
  playbook: PlaybookAddress,
  key: SubscriptionKey,
): Effect.Effect<RecordedSubscription | undefined> {
  const atItsKey = { column: rowKeyColumn, equals: eventSubscriptionIdOf(key) };
  return Effect.map(
    ledger.readProjectedRows(eventSubscriptionsName, playbook, {
      where: [atItsKey],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([found]) => (found === undefined ? undefined : recordedSubscriptionOf(found.row)),
  );
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

function isMarkedAt(recorded: RecordedSubscription | undefined, since: string): boolean {
  return recorded?.made?.type === 'polling' && recorded.made.since === since;
}

function readThroughOf(ledger: SubscriptionLedger): SubscriptionRecords['readThrough'] {
  return (playbook, key, since) =>
    Effect.gen(function* () {
      if (!isMarkedAt(yield* recordedSubscriptionAt(ledger, playbook, key), since)) {
        return;
      }
      const at = DateTime.formatIso(yield* DateTime.now);
      const command = { key: keyOf(key), since, at };
      const stream = eventSubscriptionReadStreamOf(playbook, key, since);
      yield* Effect.orDie(ledger.execute(stream, eventSubscriptionReadDecider, command));
    });
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
    marked: (playbook, key, mark, from) =>
      ledger.advanceRow(eventSubscriptionsName, playbook, eventSubscriptionIdOf(key), {
        set: markAsColumns(mark),
        when: [stillHeld, { column: 'since', equals: from }],
      }),
    readThrough: readThroughOf(ledger),
    holds: isBoundedPart,
  };
}
