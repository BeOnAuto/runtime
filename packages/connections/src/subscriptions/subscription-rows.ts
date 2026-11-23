import {
  recordedDecoder,
  type AddressedStream,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';
import {
  SubscriptionFailedBecauseSchema,
  SubscriptionFailureKindSchema,
  type MadeSubscription,
  type Mark,
  type Positions,
  type RecordedFailure,
  type RecordedSubscription,
} from '@on.auto/providers';
import { Option, Schema } from 'effect';

import {
  EventSubscriptionEventSchema,
  eventSubscriptionIdOf,
  eventSubscriptionReadsKind,
  eventSubscriptionTypes,
  eventSubscriptionsKind,
  type RecordedEventSubscriptionEvent,
  type RecordedEventSubscriptionRead,
} from './subscription-facts.ts';

export const eventSubscriptionsName = 'event_subscriptions';

const positionColumns = ['failures_in_a_row', 'lapses_at', 'due_at'] as const;

export const reconcileDueColumn = 'reconcile_due_at';

const EventSubscriptionRowSchema = Schema.Struct({
  connection: Schema.String,
  topic: Schema.String,
  removed: Schema.Boolean,
  type: Schema.NullOr(Schema.Literals(['webhook', 'queue', 'polling'])),
  id: Schema.NullOr(Schema.String),
  secret_id: Schema.NullOr(Schema.String),
  declared: Schema.NullOr(Schema.String),
  failure_kind: Schema.NullOr(SubscriptionFailureKindSchema),
  failure_because: Schema.NullOr(SubscriptionFailedBecauseSchema),
  failure_connected: Schema.NullOr(Schema.String),
  failure_declared: Schema.NullOr(Schema.String),
  failures_in_a_row: Schema.NullOr(Schema.Int),
  lapses_at: Schema.NullOr(Schema.Int),
  due_at: Schema.NullOr(Schema.Int),
  reconcile_due_at: Schema.NullOr(Schema.Int),
  since: Schema.NullOr(Schema.String),
  page_token: Schema.NullOr(Schema.String),
});

type EventSubscriptionRow = typeof EventSubscriptionRowSchema.Type;

const rowFrom: (row: ProjectedRow) => EventSubscriptionRow = Schema.decodeUnknownSync(EventSubscriptionRowSchema);

const eventSubscriptionFactOf = recordedDecoder(EventSubscriptionEventSchema);

const projectedTypes = [...eventSubscriptionTypes, 'event_subscription_read'];

const noneMade = { type: null, id: null, secret_id: null, declared: null } as const;

const noneFailed = {
  failure_kind: null,
  failure_because: null,
  failure_connected: null,
  failure_declared: null,
} as const;

const noPositions = { failures_in_a_row: null, lapses_at: null, due_at: null } as const;

const noMark = { since: null, page_token: null } as const;

function keptIn(row: ProjectedRow | undefined): EventSubscriptionRow | undefined {
  const kept = row === undefined ? undefined : rowFrom(row);
  return kept?.removed === false ? kept : undefined;
}

function standingOf(row: ProjectedRow | undefined) {
  const kept = keptIn(row);
  return kept === undefined
    ? { ...noneMade, ...noneFailed, ...noPositions, ...noMark }
    : {
        type: kept.type,
        id: kept.id,
        secret_id: kept.secret_id,
        declared: kept.declared,
        failure_kind: kept.failure_kind,
        failure_because: kept.failure_because,
        failure_connected: kept.failure_connected,
        failure_declared: kept.failure_declared,
        failures_in_a_row: kept.failures_in_a_row,
        lapses_at: kept.lapses_at,
        due_at: kept.due_at,
        since: kept.since,
        page_token: kept.page_token,
      };
}

function rowAfterRead(row: ProjectedRow | undefined, { data, context }: RecordedEventSubscriptionRead) {
  const kept = keptIn(row);
  return kept === undefined ? undefined : { ...kept, since: data.since, reconcile_due_at: Date.parse(context.at) };
}

function rowAfterFact(row: ProjectedRow | undefined, fact: RecordedEventSubscriptionEvent) {
  if (fact.type === 'event_subscription_read') {
    return rowAfterRead(row, fact);
  }
  const { type, data, context } = fact;
  const key = { connection: data.connection, topic: data.topic };
  if (type === 'event_subscription_removed') {
    return { ...key, removed: true, ...noneMade, ...noneFailed, ...noPositions, ...noMark, reconcile_due_at: null };
  }
  const standing = standingOf(row);
  const due = { reconcile_due_at: Date.parse(context.at) };
  if (type === 'event_subscription_made') {
    const made =
      data.type === 'polling'
        ? { type: data.type, id: null, secret_id: null, declared: data.declared, since: data.since }
        : { type: data.type, id: data.id, secret_id: data.secret_id ?? null, declared: data.declared, since: null };
    return { ...key, removed: false, ...standing, ...made, page_token: null, ...noneFailed, ...due };
  }
  const failure = {
    failure_kind: data.kind,
    failure_because: data.because,
    failure_connected: data.attempted?.connected ?? null,
    failure_declared: data.attempted?.declared ?? null,
  };
  return { ...key, removed: false, ...standing, ...failure, ...due };
}

function keyOfAFact(message: ProjectedMessage, { kind, id }: AddressedStream): string | undefined {
  return kind === eventSubscriptionsKind
    ? id
    : Option.getOrUndefined(Option.map(eventSubscriptionFactOf(message), ({ data }) => eventSubscriptionIdOf(data)));
}

export const eventSubscriptions: KeyedProjection = {
  name: eventSubscriptionsName,
  version: 2,
  kinds: [eventSubscriptionsKind, eventSubscriptionReadsKind],
  types: projectedTypes,
  keyOf: keyOfAFact,
  columns: [
    { name: 'connection', kind: 'text' },
    { name: 'topic', kind: 'text' },
    { name: 'removed', kind: 'boolean' },
    { name: 'type', kind: 'text' },
    { name: 'id', kind: 'text' },
    { name: 'secret_id', kind: 'text' },
    { name: 'declared', kind: 'text' },
    { name: 'failure_kind', kind: 'text' },
    { name: 'failure_because', kind: 'text' },
    { name: 'failure_connected', kind: 'text' },
    { name: 'failure_declared', kind: 'text' },
    { name: 'failures_in_a_row', kind: 'integer' },
    { name: 'lapses_at', kind: 'integer' },
    { name: 'due_at', kind: 'integer' },
    { name: reconcileDueColumn, kind: 'integer' },
    { name: 'since', kind: 'text' },
    { name: 'page_token', kind: 'text' },
  ],
  indexes: [
    { name: 'held', columns: ['removed', 'row_key'] },
    { name: 'reconcile_due', columns: [reconcileDueColumn], acrossPlaybooks: true, whereSet: reconcileDueColumn },
  ],
  advanced: [
    ...positionColumns.map((column) => ({ column, setBy: ['event_subscription_removed'] })),
    { column: reconcileDueColumn, setBy: projectedTypes },
    { column: 'since', setBy: ['event_subscription_made', 'event_subscription_read', 'event_subscription_removed'] },
    { column: 'page_token', setBy: ['event_subscription_made', 'event_subscription_removed'] },
  ],
  rowAfter: (row, message: ProjectedMessage) =>
    Option.getOrUndefined(Option.map(eventSubscriptionFactOf(message), (fact) => rowAfterFact(row, fact))),
};

function madeIn({
  type,
  id,
  secret_id: secretId,
  declared,
  since,
}: EventSubscriptionRow): MadeSubscription | undefined {
  if (type === 'polling' && declared !== null && since !== null) {
    return { type, declared, since };
  }
  if (type === null || type === 'polling' || id === null || declared === null) {
    return undefined;
  }
  return secretId === null ? { type, id, declared } : { type, id, secretId, declared };
}

export function markAsColumns({ since, pageToken, positions }: Mark): ProjectedRow {
  return { ...positionsAsColumns(positions), since, page_token: pageToken };
}

function failedIn(row: EventSubscriptionRow): RecordedFailure | undefined {
  const { failure_kind: kind, failure_because: because, failure_connected: connected } = row;
  if (kind === null || because === null) {
    return undefined;
  }
  const declared = row.failure_declared;
  if (declared === null) {
    return { kind, because };
  }
  return { kind, because, attempted: connected === null ? { declared } : { connected, declared } };
}

function positionsIn({
  failures_in_a_row: failures,
  lapses_at: lapsesAt,
  due_at: dueAt,
}: EventSubscriptionRow): Positions | undefined {
  if (failures === null) {
    return undefined;
  }
  return { failures, ...(lapsesAt === null ? {} : { lapsesAt }), ...(dueAt === null ? {} : { dueAt }) };
}

export function recordedSubscriptionOf(projected: ProjectedRow): RecordedSubscription {
  const row = rowFrom(projected);
  const made = madeIn(row);
  const failed = failedIn(row);
  const positions = positionsIn(row);
  return {
    connection: row.connection,
    topic: row.topic,
    ...(made === undefined ? {} : { made }),
    ...(failed === undefined ? {} : { failed }),
    ...(positions === undefined ? {} : { positions }),
    ...(row.page_token === null ? {} : { pageToken: row.page_token }),
  };
}

export function positionsAsColumns({ failures, lapsesAt, dueAt }: Positions): ProjectedRow {
  return { failures_in_a_row: failures, lapses_at: lapsesAt ?? null, due_at: dueAt ?? null };
}
