import {
  ActedContextSchema,
  BoundedPart,
  factOf,
  streamPrefixOfPlaybook,
  uuidV5,
  type Decided,
  type Decider,
  type PlaybookAddress,
} from '@on.auto/operations';
import {
  SubscriptionFailedBecauseSchema,
  SubscriptionFailureKindSchema,
  type MadeSubscription,
  type RecordedFailure,
  type SubscriptionKey,
} from '@on.auto/providers';
import { Result, Schema } from 'effect';

import { byTheRuntime } from '../registry/registry-decider.ts';

export const eventSubscriptionsKind = 'event-subscriptions';

const keysOfEventSubscriptions = '61f2bd8d-d827-40b6-a9a0-10129bf621ec';

const DigestSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u, { expected: 'a SHA-256 digest in lowercase hexadecimal' }),
);

const keyFields = { connection: BoundedPart, topic: BoundedPart };

const MadeDataSchema = Schema.Struct({
  ...keyFields,
  type: Schema.Literals(['webhook', 'queue']),
  id: BoundedPart,
  secret_id: Schema.optionalKey(BoundedPart),
  declared: DigestSchema,
});

const AttemptedSchema = Schema.Struct({
  connected: Schema.optionalKey(Schema.String),
  declared: DigestSchema,
});

const FailedDataSchema = Schema.Struct({
  ...keyFields,
  kind: SubscriptionFailureKindSchema,
  because: SubscriptionFailedBecauseSchema,
  attempted: Schema.optionalKey(AttemptedSchema),
});

const RemovedDataSchema = Schema.Struct(keyFields);

export const EventSubscriptionEventSchema = Schema.Union([
  factOf('event_subscription_made', MadeDataSchema, ActedContextSchema),
  factOf('event_subscription_failed', FailedDataSchema, ActedContextSchema),
  factOf('event_subscription_removed', RemovedDataSchema, ActedContextSchema),
]);

export type RecordedEventSubscriptionEvent = typeof EventSubscriptionEventSchema.Type;

type EventSubscriptionEvent = Decided<RecordedEventSubscriptionEvent>;

export const eventSubscriptionTypes: readonly RecordedEventSubscriptionEvent['type'][] = [
  'event_subscription_made',
  'event_subscription_failed',
  'event_subscription_removed',
];

export function eventSubscriptionIdOf({ connection, topic }: SubscriptionKey): string {
  return uuidV5(keysOfEventSubscriptions, JSON.stringify([connection, topic]));
}

export function eventSubscriptionStreamOf(playbook: PlaybookAddress, key: SubscriptionKey): string {
  return `${streamPrefixOfPlaybook(playbook)}${eventSubscriptionsKind}/${eventSubscriptionIdOf(key)}`;
}

export type EventSubscriptionCommand =
  | { readonly kind: 'made'; readonly key: SubscriptionKey; readonly made: MadeSubscription; readonly at: string }
  | { readonly kind: 'failed'; readonly key: SubscriptionKey; readonly failed: RecordedFailure; readonly at: string }
  | { readonly kind: 'removed'; readonly key: SubscriptionKey; readonly at: string };

interface Held {
  readonly held: boolean;
}

function keyIn({ connection, topic }: SubscriptionKey): SubscriptionKey {
  return { connection, topic };
}

function madeOf(key: SubscriptionKey, { type, id, secretId, declared }: MadeSubscription): EventSubscriptionEvent {
  const data = { ...keyIn(key), type, id, declared };
  return {
    type: 'event_subscription_made',
    data: secretId === undefined ? data : { ...data, secret_id: secretId },
  };
}

function failedOf(key: SubscriptionKey, { kind, because, attempted }: RecordedFailure): EventSubscriptionEvent {
  const data = { ...keyIn(key), kind, because };
  if (attempted === undefined) {
    return { type: 'event_subscription_failed', data };
  }
  const { connected, declared } = attempted;
  return {
    type: 'event_subscription_failed',
    data: { ...data, attempted: connected === undefined ? { declared } : { connected, declared } },
  };
}

function decidedOn(command: EventSubscriptionCommand, { held }: Held): readonly EventSubscriptionEvent[] {
  if (command.kind === 'made') {
    return [madeOf(command.key, command.made)];
  }
  if (command.kind === 'failed') {
    return [failedOf(command.key, command.failed)];
  }
  return held ? [{ type: 'event_subscription_removed', data: keyIn(command.key) }] : [];
}

export const eventSubscriptionDecider: Decider<Held, EventSubscriptionCommand, RecordedEventSubscriptionEvent> = {
  initialState: { held: false },
  evolve: (_held, { type }) => ({ held: type !== 'event_subscription_removed' }),
  decide: (command, state) => Result.succeed(decidedOn(command, state)),
  context: ({ at }) => ({ at, by: byTheRuntime }),
  eventSchema: EventSubscriptionEventSchema,
};
