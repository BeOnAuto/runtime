import { sampleMoment, type TemplateSet } from '@on.auto/definitions/tool-blocks';
import { articled, listed } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { ReadLimitSchema } from '../entry/conversation-parts.ts';
import { ValueNameSchema } from '../keys/key-fields.ts';
import {
  ChatMappingSchema,
  ConnectionSchema,
  EventMappingSchema,
  FilterSchema,
  HandshakeSchema,
  OpenSchema,
} from './destination-parts.ts';
import { ArgumentsSchema, callFields, RenewSchema, SubscribeSchema, UnsubscribeSchema } from './event-calls.ts';
import { VerifySchema } from './event-proofs.ts';
import type { ExpressionPlace } from './runtime-expressions.ts';

const ReadSchema = Schema.Struct({
  ...callFields,
  tool: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The tool that lists what is new since the last check. It must be a tool that only reads',
    }),
  ),
  with: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description: "The tool's arguments. They can use `since`, `topic` and `page_token`",
    }),
  ),
  start: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The value of `since` for the first check. It can use `now`, so that the first check lists nothing older. When it is left out, the first check reads the newest item and starts from there',
    }),
  ),
  list: Schema.String.annotate({ description: 'Where the list of items is in the answer, as a JSON Pointer' }),
  order: Schema.Literals(['oldest_first', 'newest_first']).annotate({
    description: 'The order the tool lists items in: `oldest_first` or `newest_first`',
  }),
  cursor: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Where in an item the value is that the next check passes as `since`, as a JSON Pointer. When it is left out, the item's id is used",
    }),
  ),
  next_page_token: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Where in the answer the token for the next page is, as a JSON Pointer, when the tool lists in pages',
    }),
  ),
}).annotate({ description: 'The call that lists what is new, and how to read its answer' });

export type Read = typeof ReadSchema.Type;

export const readTemplates: TemplateSet = {
  names: ['topic', 'since', 'page_token'],
  what: 'a template of the call that lists what is new',
  sample: { topic: 'C0123', since: sampleMoment, page_token: 'page-2' },
  structured: 'topic',
};

export const readStartTemplates: TemplateSet = {
  names: ['now'],
  what: 'a template of the start of a read',
  sample: { now: sampleMoment },
  structured: 'now',
};

export const DestinationFieldsSchema = Schema.Struct({
  type: Schema.Literals(['webhook', 'websocket', 'queue', 'polling']).annotate({
    description:
      "How the runtime hears: webhook, an HTTP request the service sends to the runtime's address; websocket, down a socket the runtime opens to the service; queue, into a queue the runtime reads; polling, by calling a tool of the service on a timer and taking what is new",
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
        'Per subscription, the topic, as WebSub names the unit one subscribes to: a Liquid template over with, the arguments of the call that delivered a request, and sent.conversation and sent.id, rendering the place one subscription serves, such as a repository or a chat. The calls subscribe, renew and unsubscribe read it as topic',
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
  read: Schema.optionalKey(ReadSchema),
  read_limit: Schema.optionalKey(ReadLimitSchema),
  filter: Schema.optionalKey(FilterSchema),
  events: Schema.optionalKey(
    Schema.Array(EventMappingSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'Which deliveries are events the service reports. A delivery is the event of the first item it matches. On a polling destination, it says which listed items count as events, and an item becomes the event of the first entry it matches. Only a provider that ships with the runtime can declare them.',
    }),
  ),
  chat: Schema.optionalKey(
    Schema.Array(ChatMappingSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'Which deliveries are messages a person wrote where the app reads, and of which kind. A delivery is the message of the first item it matches. Only a provider that ships with the runtime can declare them.',
    }),
  ),
  connection: Schema.optionalKey(ConnectionSchema),
  kind: Schema.optionalKey(
    Schema.Literals(['azure-event-hubs', 'google-cloud-pubsub', 'amazon-eventbridge']).annotate({
      description: "For queue, the queue the service delivers into, by its vendor's name for it",
    }),
  ),
  open: Schema.optionalKey(OpenSchema),
  credential: Schema.optionalKey(
    ValueNameSchema.annotate({
      description:
        "For websocket, the value of the app that opens the socket, named as the vendor names it, such as app_level_token: an app credential of the entry's secret way, sent as a bearer token with the request of open",
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

type Field = Exclude<keyof Destination, 'type' | 'filter' | 'events' | 'chat'>;

type Shape =
  | 'webhook per subscription'
  | 'webhook per app'
  | 'queue per subscription'
  | 'queue per app'
  | 'websocket'
  | 'polling';

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
  'read',
  'read_limit',
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
  polling: { required: ['read'], optional: ['read_limit'] },
};

const nounOfEachShape: Readonly<Record<Shape, string>> = {
  'webhook per subscription': 'a webhook destination per subscription',
  'webhook per app': 'a webhook destination per app',
  'queue per subscription': 'a queue destination per subscription',
  'queue per app': 'a queue destination per app',
  websocket: 'a websocket destination',
  polling: 'a polling destination',
};

const keptForEachPlace: ReadonlySet<Shape> = new Set(['webhook per subscription', 'queue per subscription', 'polling']);

function shapeOf({ type, per }: Destination): Shape | undefined {
  if (type === 'websocket' || type === 'polling') {
    return type;
  }
  return per === undefined ? undefined : `${type} per ${per}`;
}

export function subscribesForEachPlace(destination: Destination): boolean {
  const shape = shapeOf(destination);
  return shape !== undefined && keptForEachPlace.has(shape);
}

export function arrangesNoSubscription(destination: Destination): boolean {
  return shapeOf(destination) !== undefined && !subscribesForEachPlace(destination);
}

export function transportOf({ type }: Destination): ExpressionPlace['transport'] {
  return type === 'webhook' ? 'request' : 'message';
}

function takenInWords({ required, optional }: TakenFields): string {
  return listed([...required, ...optional].filter((field) => field !== 'per'));
}

function filterIssuesOf(destination: Destination, shape: Shape): readonly DestinationIssue[] {
  const noun = nounOfEachShape[shape];
  const given = destination.filter !== undefined;
  if (shape === 'polling') {
    const taken = fieldsOfEachShape[shape];
    return given ? [{ path: ['filter'], issue: `Expected no filter: ${noun} takes ${takenInWords(taken)}` }] : [];
  }
  return given ? [] : [{ path: ['filter'], issue: `Expected filter, which ${noun} takes` }];
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
  return [
    ...filterIssuesOf(destination, shape),
    ...everyField.flatMap((field): readonly DestinationIssue[] => {
      const given = destination[field] !== undefined;
      if (!given && taken.required.includes(field)) {
        return [{ path: [field], issue: `Expected ${field}, which ${noun} takes` }];
      }
      return given && !taken.required.includes(field) && !taken.optional.includes(field)
        ? [{ path: [field], issue: `Expected no ${field}: ${noun} takes ${takenInWords(taken)}` }]
        : [];
    }),
  ];
}
