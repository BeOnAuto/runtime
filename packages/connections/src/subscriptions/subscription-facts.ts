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

export const eventSubscriptionReadsKind = 'event-subscription-reads';

const keysOfEventSubscriptions = '61f2bd8d-d827-40b6-a9a0-10129bf621ec';

const keysOfEventSubscriptionReads = '3b0f7c52-8d1e-4a6f-9c27-5e4d1a8b6f03';

const DigestSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u, { expected: 'a SHA-256 digest in lowercase hexadecimal' }),
);

const keyFields = { connection: BoundedPart, topic: BoundedPart };

const SinceSchema = Schema.Union([Schema.Literal(''), BoundedPart]);

const MadeThroughACallSchema = Schema.Struct({
  ...keyFields,
  type: Schema.Literals(['webhook', 'queue']),
  id: BoundedPart,
  secret_id: Schema.optionalKey(BoundedPart),
  declared: DigestSchema,
});

const MadeByPollingSchema = Schema.Struct({
  ...keyFields,
  type: Schema.Literal('polling'),
  declared: DigestSchema,
  since: SinceSchema,
});

const MadeDataSchema = Schema.Union([MadeThroughACallSchema, MadeByPollingSchema]);

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

export const SubscriptionStreamFactSchema = Schema.Union([
  factOf('event_subscription_made', MadeDataSchema, ActedContextSchema),
  factOf('event_subscription_failed', FailedDataSchema, ActedContextSchema),
  factOf('event_subscription_removed', RemovedDataSchema, ActedContextSchema),
]);

export type RecordedSubscriptionStreamFact = typeof SubscriptionStreamFactSchema.Type;

type SubscriptionStreamFact = Decided<RecordedSubscriptionStreamFact>;

export const EventSubscriptionReadSchema = factOf(
  'event_subscription_read',
  Schema.Struct({ ...keyFields, since: SinceSchema }),
  ActedContextSchema,
);

export type RecordedEventSubscriptionRead = typeof EventSubscriptionReadSchema.Type;

export const EventSubscriptionEventSchema = Schema.Union([SubscriptionStreamFactSchema, EventSubscriptionReadSchema]);

export type RecordedEventSubscriptionEvent = typeof EventSubscriptionEventSchema.Type;

export const eventSubscriptionTypes: readonly RecordedSubscriptionStreamFact['type'][] = [
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

export function eventSubscriptionReadStreamOf(
  playbook: PlaybookAddress,
  { connection, topic }: SubscriptionKey,
  since: string,
) {
  const id = uuidV5(keysOfEventSubscriptionReads, JSON.stringify([connection, topic, since]));
  return `${streamPrefixOfPlaybook(playbook)}${eventSubscriptionReadsKind}/${id}`;
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

function madeOf(key: SubscriptionKey, made: MadeSubscription): SubscriptionStreamFact {
  if (made.type === 'polling') {
    const { type, declared, since } = made;
    return { type: 'event_subscription_made', data: { ...keyIn(key), type, declared, since } };
  }
  const { type, id, secretId, declared } = made;
  const data = { ...keyIn(key), type, id, declared };
  return {
    type: 'event_subscription_made',
    data: secretId === undefined ? data : { ...data, secret_id: secretId },
  };
}

function failedOf(key: SubscriptionKey, { kind, because, attempted }: RecordedFailure): SubscriptionStreamFact {
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

function decidedOn(command: EventSubscriptionCommand, { held }: Held): readonly SubscriptionStreamFact[] {
  if (command.kind === 'made') {
    return [madeOf(command.key, command.made)];
  }
  if (command.kind === 'failed') {
    return [failedOf(command.key, command.failed)];
  }
  return held ? [{ type: 'event_subscription_removed', data: keyIn(command.key) }] : [];
}

export const eventSubscriptionDecider: Decider<Held, EventSubscriptionCommand, RecordedSubscriptionStreamFact> = {
  initialState: { held: false },
  evolve: (_held, { type }) => ({ held: type !== 'event_subscription_removed' }),
  decide: (command, state) => Result.succeed(decidedOn(command, state)),
  context: ({ at }) => ({ at, by: byTheRuntime }),
  eventSchema: SubscriptionStreamFactSchema,
};

export interface EventSubscriptionReadCommand {
  readonly key: SubscriptionKey;
  readonly since: string;
  readonly at: string;
}

interface Recorded {
  readonly recorded: boolean;
}

export const eventSubscriptionReadDecider: Decider<
  Recorded,
  EventSubscriptionReadCommand,
  RecordedEventSubscriptionRead
> = {
  initialState: { recorded: false },
  evolve: () => ({ recorded: true }),
  decide: ({ key, since }, { recorded }) =>
    Result.succeed(recorded ? [] : [{ type: 'event_subscription_read', data: { ...keyIn(key), since } }]),
  context: ({ at }) => ({ at, by: byTheRuntime }),
  eventSchema: EventSubscriptionReadSchema,
};
