import { problemsOf } from './entry-problems.ts';
import { tracker } from './fixture-providers.ts';

export function without(written: object, ...left: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(written).filter(([key]: readonly [string, unknown]) => !left.includes(key)));
}

export function sentBy(...destinations: readonly unknown[]): readonly (readonly [string, string])[] {
  return problemsOf({ ...tracker, events: { destinations } });
}

export const firstDestination = '/events/destinations/0';

export const ofEachSubscription = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.project }}',
  subscribe: {
    method: 'POST',
    url: 'https://api.tracker.example.com/projects/{{ with.project }}/hooks',
    body: { url: '{{ webhook_url }}', secret: '{{ secret }}', events: ['comment'] },
    subscribed: { id: '/id' },
  },
  unsubscribe: {
    method: 'DELETE',
    url: 'https://api.tracker.example.com/projects/{{ with.project }}/hooks/{{ subscription.id }}',
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
  wake: {
    when: { '$request.header.X-Tracker-Event': ['comment'] },
    subscription: '$request.header.X-Tracker-Hook',
  },
};

export const ofTheApp = {
  type: 'webhook',
  per: 'app',
  verify: {
    scheme: 'hmac',
    secret: 'app',
    hash: 'sha256',
    signed_payload: 'v0:{timestamp}:{payload}',
    signature: '$request.header.X-Chat-Signature',
    prefix: 'v0=',
    encoding: 'hex',
    timestamp: '$request.header.X-Chat-Request-Timestamp',
  },
  handshake: {
    when: { '$request.body#/type': ['url_verification'] },
    challenge: '$request.body#/challenge',
    signed: true,
  },
  wake: {
    when: { '$request.body#/type': ['event_callback'], '$request.body#/event/type': ['message'] },
    conversation: '$request.body#/event/channel',
    automatic: '$request.body#/event/bot_id',
  },
  connection: { account: '$request.body#/team_id' },
};

export const overASocket = {
  type: 'websocket',
  open: { tool: 'open_connection', address: '/url' },
  credential: 'app_level_token',
  acknowledge: '$message.payload#/envelope_id',
  heartbeat_seconds: 30,
  wake: {
    when: { '$message.payload#/type': ['events_api'] },
    conversation: '$message.payload#/payload/event/channel',
  },
  connection: { account: '$message.payload#/payload/team_id', user: '$message.payload#/payload/event/user' },
};

export const intoAQueue = {
  type: 'queue',
  per: 'subscription',
  kind: 'azure-event-hubs',
  topic: '{{ sent.conversation }}',
  subscribe: {
    tool: 'create_subscription',
    with: {
      resource: 'chats/{{ sent.conversation }}/messages',
      notificationUrl: '{{ queue_url }}',
      expirationDateTime: '{{ lease.expires_at }}',
    },
    subscribed: { id: '/id', expires_at: '/expirationDateTime' },
  },
  renew: {
    tool: 'update_subscription',
    with: { id: '{{ subscription.id }}', expirationDateTime: '{{ lease.expires_at }}' },
    renewed: { expires_at: '/expirationDateTime' },
  },
  lease_seconds: 259_200,
  unsubscribe: { tool: 'delete_subscription', with: { id: '{{ subscription.id }}' } },
  wake: { when: { '$message.payload#/changeType': ['created'] }, subscription: '$message.payload#/subscriptionId' },
};
