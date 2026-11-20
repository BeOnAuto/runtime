import { listed } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { isAFieldOfAProof, proofFieldsInWords } from './event-proofs.ts';

type JsonObject = Readonly<Record<string, Schema.Json>>;

type Issue = Schema.FilterIssue;

type Path = readonly (string | number)[];

const isAnObject = Schema.is(Schema.Record(Schema.String, Schema.Json));

const isAList = Schema.is(Schema.Array(Schema.Json));

const ofTheWebhookAlone =
  'Expected webhook: write webhook here, because a connection added without a provider can receive only webhooks';

const perPlace =
  'Expected subscription: write subscription here, because Auto registers its webhook URL itself with the subscribe call. If the service takes a webhook URL only in its own settings, leave events out';

const throughItsTools =
  "Expected tool, with the tool's arguments in with, and no method, url or body: name a tool of this connection here, because Auto makes this call only through the connection's tools";

const noAppSecret =
  'Expected subscription: write subscription here, because Auto verifies webhooks with the secret of each registration, which Auto makes or the subscribe call returns. If the service shows its secret only in its own settings, leave events out';

const onlyMakesAutoRead =
  "Expected no reply: remove it, because a webhook from this service only tells Auto to read the replies now. The function's own replies says how they are read";

function takenByNone(field: string): string {
  return `Expected no ${field}: remove it, because a connection added without a provider does not take ${field}`;
}

const fieldsOfOtherWays: readonly string[] = [
  'needs',
  'connection',
  'kind',
  'open',
  'credential',
  'acknowledge',
  'heartbeat_seconds',
];

const fieldsOfADestination: readonly string[] = [
  'type',
  'per',
  'topic',
  'subscribe',
  'unsubscribe',
  'verify',
  'filter',
  'renew',
  'lease_seconds',
  'handshake',
];

const fieldsOfARequest: readonly string[] = ['method', 'url', 'body'];

interface Place {
  readonly named: string;
  readonly takes: readonly string[];
  readonly refusedOtherwise?: readonly string[];
}

const places = {
  events: { named: 'events', takes: ['destinations'] },
  destination: {
    named: 'a destination in events',
    takes: fieldsOfADestination,
    refusedOtherwise: fieldsOfOtherWays,
  },
  subscribe: { named: 'subscribe', takes: ['tool', 'with', 'subscribed'] },
  renew: { named: 'renew', takes: ['tool', 'with', 'renewed'] },
  unsubscribe: { named: 'unsubscribe', takes: ['tool', 'with'] },
  subscribed: { named: 'subscribed', takes: ['id', 'expires_at', 'secret'] },
  renewed: { named: 'renewed', takes: ['expires_at'] },
  filter: {
    named: 'filter',
    takes: ['when', 'subscription', 'conversation', 'automatic'],
    refusedOtherwise: ['reply'],
  },
  handshake: { named: 'handshake', takes: ['when', 'challenge', 'response', 'signed'] },
} as const satisfies Readonly<Record<string, Place>>;

function unknownKeysIn(
  value: JsonObject,
  path: Path,
  { named, takes, refusedOtherwise = [] }: Place,
): readonly Issue[] {
  return Object.keys(value)
    .filter((key) => !takes.includes(key) && !refusedOtherwise.includes(key))
    .map((key) => ({ path: [...path, key], issue: `Expected no ${key}: ${named} takes only ${listed(takes)}` }));
}

function objectAt(value: JsonObject, key: string): JsonObject | undefined {
  const held = value[key];
  return isAnObject(held) ? held : undefined;
}

function isMadeByATool(call: Schema.Json | undefined): call is JsonObject {
  return isAnObject(call) && call['tool'] !== undefined && !fieldsOfARequest.some((field) => call[field] !== undefined);
}

function answerIssuesOf(call: JsonObject, path: Path, answer: 'subscribed' | 'renewed'): readonly Issue[] {
  const answered = objectAt(call, answer);
  return answered === undefined ? [] : unknownKeysIn(answered, [...path, answer], places[answer]);
}

function callIssuesOf(
  destination: JsonObject,
  path: Path,
  call: 'subscribe' | 'renew' | 'unsubscribe',
): readonly Issue[] {
  const written = destination[call];
  if (written === undefined) {
    return [];
  }
  if (!isMadeByATool(written)) {
    return [{ path: [...path, call], issue: throughItsTools }];
  }
  const at = [...path, call];
  return [
    ...unknownKeysIn(written, at, places[call]),
    ...(call === 'unsubscribe' ? [] : answerIssuesOf(written, at, call === 'subscribe' ? 'subscribed' : 'renewed')),
  ];
}

function verifyIssuesOf(destination: JsonObject, path: Path): readonly Issue[] {
  const verify = objectAt(destination, 'verify');
  if (verify === undefined) {
    return [];
  }
  const { secret } = verify;
  const takes = proofFieldsInWords(verify['scheme']);
  return [
    ...(secret === undefined || secret === 'subscription'
      ? []
      : [{ path: [...path, 'verify', 'secret'], issue: noAppSecret }]),
    ...(takes === undefined
      ? []
      : Object.keys(verify)
          .filter((key) => !isAFieldOfAProof(key))
          .map((key) => ({ path: [...path, 'verify', key], issue: `Expected no ${key}: ${takes}` }))),
  ];
}

function filterIssuesOf(destination: JsonObject, path: Path): readonly Issue[] {
  const filter = objectAt(destination, 'filter');
  if (filter === undefined) {
    return [];
  }
  return [
    ...(filter['reply'] === undefined ? [] : [{ path: [...path, 'filter', 'reply'], issue: onlyMakesAutoRead }]),
    ...unknownKeysIn(filter, [...path, 'filter'], places.filter),
  ];
}

function handshakeIssuesOf(destination: JsonObject, path: Path): readonly Issue[] {
  const handshake = objectAt(destination, 'handshake');
  return handshake === undefined ? [] : unknownKeysIn(handshake, [...path, 'handshake'], places.handshake);
}

function destinationIssuesIn(destination: JsonObject, path: Path): readonly Issue[] {
  return [
    ...(destination['type'] === 'webhook' ? [] : [{ path: [...path, 'type'], issue: ofTheWebhookAlone }]),
    ...(destination['per'] === 'subscription' ? [] : [{ path: [...path, 'per'], issue: perPlace }]),
    ...callIssuesOf(destination, path, 'subscribe'),
    ...callIssuesOf(destination, path, 'renew'),
    ...callIssuesOf(destination, path, 'unsubscribe'),
    ...verifyIssuesOf(destination, path),
    ...filterIssuesOf(destination, path),
    ...handshakeIssuesOf(destination, path),
    ...fieldsOfOtherWays
      .filter((field) => destination[field] !== undefined)
      .map((field) => ({ path: [...path, field], issue: takenByNone(field) })),
    ...unknownKeysIn(destination, path, places.destination),
  ];
}

export function narrowedIssuesIn(events: JsonObject): readonly Issue[] {
  const { destinations } = events;
  const written = isAList(destinations) ? destinations : [];
  return [
    ...unknownKeysIn(events, [], places.events),
    ...written.flatMap((destination, index) =>
      isAnObject(destination) ? destinationIssuesIn(destination, ['destinations', index]) : [],
    ),
  ];
}
