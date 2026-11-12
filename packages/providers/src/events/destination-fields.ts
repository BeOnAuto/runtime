import { articled, listed } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { ConnectionSchema, HandshakeSchema, OpenSchema, WakeSchema } from './destination-parts.ts';
import { RenewSchema, SubscribeSchema, UnsubscribeSchema } from './event-calls.ts';
import { VerifySchema } from './event-proofs.ts';
import type { ExpressionPlace } from './runtime-expressions.ts';

export const DestinationFieldsSchema = Schema.Struct({
  type: Schema.Literals(['webhook', 'websocket', 'queue']).annotate({
    description:
      "How the service sends: webhook, an HTTP request to the runtime's address; websocket, down a socket the runtime opens to the service; queue, into a queue the runtime reads",
  }),
  per: Schema.optionalKey(
    Schema.Literals(['subscription', 'app']).annotate({
      description:
        'For webhook and queue, how sending is arranged: subscription, by a call Auto makes for each place requests wait in; app, once on the app at the vendor, for everyone who connects through it',
    }),
  ),
  topic: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Per subscription, the topic, as WebSub names the unit one subscribes to: a Liquid template over with, the arguments of the call that delivered a request, and sent.conversation and sent.id, rendering the place one subscription serves, such as a repository or a chat',
    }),
  ),
  subscribe: Schema.optionalKey(SubscribeSchema),
  renew: Schema.optionalKey(RenewSchema),
  unsubscribe: Schema.optionalKey(UnsubscribeSchema),
  lease_seconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "Per subscription, the most seconds a subscription lasts before it lapses, as WebSub's lease",
    }),
  ),
  needs: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Per subscription, the group of more of the entry's authorization way whose scopes subscribing takes, where the way's own scope does not cover it",
    }),
  ),
  verify: Schema.optionalKey(VerifySchema),
  handshake: Schema.optionalKey(HandshakeSchema),
  wake: WakeSchema,
  connection: Schema.optionalKey(ConnectionSchema),
  kind: Schema.optionalKey(
    Schema.Literals(['azure-event-hubs', 'google-cloud-pubsub', 'amazon-eventbridge']).annotate({
      description: "For queue, the queue the service delivers into, by its vendor's name for it",
    }),
  ),
  open: Schema.optionalKey(OpenSchema),
  credential: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u, {
        expected: 'the name of a value of the app, 1 to 64 lowercase letters, digits and underscores',
      }),
    ).annotate({
      description:
        'For websocket, the value of the app that opens the socket, named as the vendor names it, such as app_level_token',
    }),
  ),
  acknowledge: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For websocket, where a message names the id the runtime acknowledges it by',
    }),
  ),
  heartbeat_seconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: 'For websocket, how often the service asks the runtime to send it a heartbeat, in seconds',
    }),
  ),
});

export type Destination = typeof DestinationFieldsSchema.Type;

export type DestinationIssue = Schema.FilterIssue;

type Field = Exclude<keyof Destination, 'type' | 'wake'>;

type Shape = 'webhook per subscription' | 'webhook per app' | 'queue per subscription' | 'queue per app' | 'websocket';

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const everyField: readonly Field[] = [
  'per',
  'topic',
  'subscribe',
  'renew',
  'unsubscribe',
  'lease_seconds',
  'needs',
  'verify',
  'handshake',
  'connection',
  'kind',
  'open',
  'credential',
  'acknowledge',
  'heartbeat_seconds',
];

const subscribing: TakenFields = {
  required: ['per', 'topic', 'subscribe', 'unsubscribe'],
  optional: ['renew', 'lease_seconds', 'needs'],
};

const fieldsOfEachShape: Readonly<Record<Shape, TakenFields>> = {
  'webhook per subscription': {
    required: [...subscribing.required, 'verify'],
    optional: [...subscribing.optional, 'handshake'],
  },
  'webhook per app': { required: ['per', 'verify', 'connection'], optional: ['handshake'] },
  'queue per subscription': { required: [...subscribing.required, 'kind'], optional: subscribing.optional },
  'queue per app': { required: ['per', 'kind', 'connection'], optional: [] },
  websocket: { required: ['open', 'credential', 'connection'], optional: ['acknowledge', 'heartbeat_seconds'] },
};

const nounOfEachShape: Readonly<Record<Shape, string>> = {
  'webhook per subscription': 'a webhook destination per subscription',
  'webhook per app': 'a webhook destination per app',
  'queue per subscription': 'a queue destination per subscription',
  'queue per app': 'a queue destination per app',
  websocket: 'a websocket destination',
};

function shapeOf({ type, per }: Destination): Shape | undefined {
  if (type === 'websocket') {
    return type;
  }
  return per === undefined ? undefined : `${type} per ${per}`;
}

export function arrangesNoSubscription(destination: Destination): boolean {
  const shape = shapeOf(destination);
  return shape !== undefined && !shape.endsWith('per subscription');
}

export function transportOf({ type }: Destination): ExpressionPlace['transport'] {
  return type === 'webhook' ? 'request' : 'message';
}

function takenInWords({ required, optional }: TakenFields): string {
  return listed([...required, ...optional].filter((field) => field !== 'per'));
}

export function presenceIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const shape = shapeOf(destination);
  if (shape === undefined) {
    return [
      {
        path: ['per'],
        issue: `Expected per, which ${articled(`${destination.type} destination`)} takes: subscription or app`,
      },
    ];
  }
  const taken = fieldsOfEachShape[shape];
  const noun = nounOfEachShape[shape];
  return everyField.flatMap((field): readonly DestinationIssue[] => {
    const given = destination[field] !== undefined;
    if (!given && taken.required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which ${noun} takes` }];
    }
    return given && !taken.required.includes(field) && !taken.optional.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: ${noun} takes ${takenInWords(taken)}` }]
      : [];
  });
}
