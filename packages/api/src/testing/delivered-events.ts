import { createHmac } from 'node:crypto';

import { eventDestinationOf, providersShippedRoots, readProviders, type EventDestination } from '@on.auto/providers';
import { providersOf, tracker } from '@on.auto/providers/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Redacted, Result } from 'effect';

import { deliveredEventRoutes, type ArrivedEvent, type EventServing, type HeardEvent } from '../index.ts';
import { deliveryBounds } from '../webhooks/delivery-bounds.ts';
import { createTestHandler } from './api-calls.ts';

export const nowSeconds = 1_794_318_120;

export const ticketsSecret = 'a secret the tracker was given for hook-7';

export const roomsSecret = 'the signing secret of the rooms app';

export const eventsPath = (connection: string) => `/v1/orgs/acme/playbooks/ops/connections/${connection}/events`;

const ofEachSubscription = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.project }}',
  subscribe: {
    method: 'POST',
    url: 'https://api.tracker.example.com/projects/{{ topic }}/hooks',
    body: { url: '{{ webhook_url }}', secret: '{{ secret }}' },
    subscribed: { id: '/id' },
  },
  unsubscribe: {
    method: 'DELETE',
    url: 'https://api.tracker.example.com/projects/{{ topic }}/hooks/{{ subscription.id }}',
  },
  verify: {
    scheme: 'hmac',
    secret: 'subscription',
    hash: 'sha256',
    signed_payload: '{payload}',
    signature: '$request.header.X-Tracker-Signature',
    prefix: 'sha256=',
    encoding: 'hex',
    id: '$request.header.X-Tracker-Delivery',
  },
  handshake: {
    when: { '$request.query.hub.mode': ['subscribe', 'unsubscribe'] },
    challenge: '$request.query.hub.challenge',
    signed: false,
  },
  filter: {
    when: { '$request.header.X-Tracker-Event': ['comment'] },
    subscription: '$request.header.X-Tracker-Hook',
    conversation: '$request.body#/comment/thread',
  },
};

const ofTheApp = {
  type: 'webhook',
  per: 'app',
  verify: {
    scheme: 'hmac',
    secret: 'app',
    hash: 'sha256',
    signed_payload: 'v1:{timestamp}:{payload}',
    signature: '$request.header.X-Rooms-Signature',
    prefix: 'v1=',
    encoding: 'base64',
    timestamp: '$request.header.X-Rooms-Timestamp',
  },
  handshake: {
    when: { '$request.body#/kind': ['address_check'] },
    challenge: '$request.body#/check/token',
    response: { token: 'challenge', proof: 'hmac' },
    signed: true,
  },
  filter: { when: { '$request.body#/kind': ['message_posted'] }, conversation: '$request.body#/message/room' },
  connection: { account: '$request.body#/workspace' },
};

const entries = providersOf(
  { ...tracker, events: { destinations: [ofEachSubscription] } },
  { ...tracker, name: 'rooms', title: 'Rooms', events: { destinations: [ofTheApp] } },
);

function destinationOf(provider: string): EventDestination {
  return Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(entries, provider, 'webhook')));
}

export const tickets = destinationOf('tracker');

export const rooms = destinationOf('rooms');

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

/** The webhook GitHub's shipped entry declares, made for each subscription. */
const githubs = Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(shipped, 'github', 'webhook')));

/** The secret of GitHub's published check of a delivery's signature (docs.github.com, validating webhook deliveries). */
const githubsCheckSecret = "It's a Secret to Everybody";

export const githubsHook = '480932108';

interface Signing {
  readonly secret?: string;
  readonly event?: string;
  readonly timestamp?: number;
}

export function ticketHeaders(
  body: string | Readonly<Uint8Array>,
  { secret = ticketsSecret, event = 'comment' }: Signing = {},
): Readonly<Record<string, string>> {
  const signed = typeof body === 'string' ? body : Uint8Array.from(body);
  return {
    'content-type': 'application/json',
    'x-tracker-event': event,
    'x-tracker-hook': 'hook-7',
    'x-tracker-delivery': 'delivery-31',
    'x-tracker-signature': `sha256=${createHmac('sha256', secret).update(signed).digest('hex')}`,
  };
}

export function githubHeaders(
  body: string,
  { secret = githubsCheckSecret, event = 'issue_comment' }: Signing = {},
): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-hook-id': githubsHook,
    'x-github-delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
    'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  };
}

export function roomHeaders(
  body: string,
  { secret = roomsSecret, timestamp = nowSeconds }: Signing = {},
): Readonly<Record<string, string>> {
  const signature = createHmac('sha256', secret).update(`v1:${timestamp}:${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'x-rooms-timestamp': String(timestamp),
    'x-rooms-signature': `v1=${signature}`,
  };
}

interface EventsServed {
  readonly arrived: ArrivedEvent[];
  readonly heard: HeardEvent[];
  readonly asked: string[];
}

const destinations = new Map([
  ['tickets', tickets],
  ['rooms', rooms],
  ['drafts', tickets],
  ['github', githubs],
]);

const secretsOf = new Map([
  ['tickets subscription', [ticketsSecret]],
  ['rooms app', [roomsSecret]],
  ['github subscription', [githubsCheckSecret]],
]);

export function eventsServedWith(changes: Partial<EventServing> = {}) {
  const served: EventsServed = { arrived: [], heard: [], asked: [] };
  const serving: EventServing = {
    destination: ({ connection }) => {
      served.asked.push(`destination of ${connection}`);
      return Promise.resolve(destinations.get(connection));
    },
    secrets: ({ connection }, secret) => {
      served.asked.push(`secrets of ${connection} by ${secret}`);
      return Promise.resolve((secretsOf.get(`${connection} ${secret}`) ?? []).map((text) => Redacted.make(text)));
    },
    arrived: (event) => {
      served.arrived.push(event);
      return Promise.resolve();
    },
    heard: (event) => {
      served.heard.push(event);
    },
    now: () => nowSeconds * 1000,
    bounds: deliveryBounds,
    ...changes,
  };
  const { handler, reported } = createTestHandler({ routes: [deliveredEventRoutes(serving)] });
  return { handler, served, reported };
}
