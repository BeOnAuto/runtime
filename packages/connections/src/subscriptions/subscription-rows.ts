import { recordedDecoder, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import {
  SubscriptionFailedBecauseSchema,
  SubscriptionFailureKindSchema,
  type MadeSubscription,
  type Positions,
  type RecordedFailure,
  type RecordedSubscription,
} from '@on.auto/providers';
import { Option, Schema } from 'effect';

import {
  EventSubscriptionEventSchema,
  eventSubscriptionTypes,
  eventSubscriptionsKind,
  type RecordedEventSubscriptionEvent,
} from './subscription-facts.ts';

export const eventSubscriptionsName = 'event_subscriptions';

const positionColumns = ['failures_in_a_row', 'lapses_at', 'due_at'] as const;

export const reconcileDueColumn = 'reconcile_due_at';

const EventSubscriptionRowSchema = Schema.Struct({
  connection: Schema.String,
  topic: Schema.String,
  removed: Schema.Boolean,
  type: Schema.NullOr(Schema.Literals(['webhook', 'queue'])),
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
});

type EventSubscriptionRow = typeof EventSubscriptionRowSchema.Type;

const rowFrom: (row: ProjectedRow) => EventSubscriptionRow = Schema.decodeUnknownSync(EventSubscriptionRowSchema);

const eventSubscriptionFactOf = recordedDecoder(EventSubscriptionEventSchema);

const noneMade = { type: null, id: null, secret_id: null, declared: null } as const;

const noneFailed = {
  failure_kind: null,
  failure_because: null,
  failure_connected: null,
  failure_declared: null,
} as const;

const noPositions = { failures_in_a_row: null, lapses_at: null, due_at: null } as const;

function standingOf(row: ProjectedRow | undefined) {
  const kept = row === undefined ? undefined : rowFrom(row);
  return kept === undefined || kept.removed
    ? { ...noneMade, ...noneFailed, ...noPositions }
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
      };
}

function rowAfterFact(row: ProjectedRow | undefined, { type, data, context }: RecordedEventSubscriptionEvent) {
  const key = { connection: data.connection, topic: data.topic };
  if (type === 'event_subscription_removed') {
    return { ...key, removed: true, ...noneMade, ...noneFailed, ...noPositions, reconcile_due_at: null };
  }
  const standing = standingOf(row);
  const due = { reconcile_due_at: Date.parse(context.at) };
  if (type === 'event_subscription_made') {
    const made = { type: data.type, id: data.id, secret_id: data.secret_id ?? null, declared: data.declared };
    return { ...key, removed: false, ...standing, ...made, ...noneFailed, ...due };
  }
  const failure = {
    failure_kind: data.kind,
    failure_because: data.because,
    failure_connected: data.attempted?.connected ?? null,
    failure_declared: data.attempted?.declared ?? null,
  };
  return { ...key, removed: false, ...standing, ...failure, ...due };
}

export const eventSubscriptions: KeyedProjection = {
  name: eventSubscriptionsName,
  version: 1,
  kinds: [eventSubscriptionsKind],
  types: eventSubscriptionTypes,
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
  ],
  indexes: [
    { name: 'held', columns: ['removed', 'row_key'] },
    { name: 'reconcile_due', columns: [reconcileDueColumn], acrossPlaybooks: true, whereSet: reconcileDueColumn },
  ],
  advanced: [
    ...positionColumns.map((column) => ({ column, setBy: ['event_subscription_removed'] })),
    { column: reconcileDueColumn, setBy: eventSubscriptionTypes },
  ],
  rowAfter: (row, message: ProjectedMessage) =>
    Option.getOrUndefined(Option.map(eventSubscriptionFactOf(message), (fact) => rowAfterFact(row, fact))),
};

function madeIn({ type, id, secret_id: secretId, declared }: EventSubscriptionRow): MadeSubscription | undefined {
  if (type === null || id === null || declared === null) {
    return undefined;
  }
  return secretId === null ? { type, id, declared } : { type, id, secretId, declared };
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
  };
}

export function positionsAsColumns({ failures, lapsesAt, dueAt }: Positions): ProjectedRow {
  return { failures_in_a_row: failures, lapses_at: lapsesAt ?? null, due_at: dueAt ?? null };
}
