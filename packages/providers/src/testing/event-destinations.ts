import { problemsOf } from './entry-problems.ts';
import { tracker } from './fixture-providers.ts';

export function without(written: object, ...left: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(written).filter(([key]: readonly [string, unknown]) => !left.includes(key)));
}

export const appLevelToken = {
  name: 'app_level_token',
  description: 'Chat app-level token',
  instructions: 'Make a token under **Basic Information**, **App-Level Tokens**, with the scope `connections:write`.',
  key_page: 'https://api.chat.example.com/apps',
  example: 'xapp-…',
  pattern: '^xapp-.+$',
};

const [aKey, ...otherWays] = tracker.credentials;

export const trackerOverASocket = {
  ...tracker,
  credentials: [{ ...aKey, app_credentials: [appLevelToken] }, ...otherWays],
};

export function sentBy(...destinations: readonly unknown[]): readonly (readonly [string, string])[] {
  return problemsOf({ ...trackerOverASocket, events: { destinations } });
}

export const firstDestination = '/events/destinations/0';

export const aReply = {
  id: '$request.body#/message/id',
  sender: '$request.body#/message/author',
  text: '$request.body#/message/text',
  to: '$request.body#/message/in_reply_to',
  time: '$request.body#/message/written_at',
  changed: '$request.body#/message/edited',
};

export function carrying(destination: { readonly filter: object }, reply: unknown): Readonly<Record<string, unknown>> {
  return { ...destination, filter: { ...destination.filter, reply } };
}

export const ofEachSubscription = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.project }}',
  subscribe: {
    method: 'POST',
    url: 'https://api.tracker.example.com/projects/{{ topic }}/hooks',
    body: { url: '{{ webhook_url }}', secret: '{{ secret }}', events: ['comment'] },
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
  filter: {
    when: { '$request.header.X-Tracker-Event': ['comment'] },
    subscription: '$request.header.X-Tracker-Hook',
  },
};

export const throughItsTools = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.project }}',
  subscribe: {
    tool: 'create_hook',
    with: { project: '{{ topic }}', url: '{{ webhook_url }}', secret: '{{ secret }}' },
    subscribed: { id: '/id' },
  },
  unsubscribe: { tool: 'delete_hook', with: { project: '{{ topic }}', id: '{{ subscription.id }}' } },
  verify: {
    scheme: 'hmac',
    secret: 'subscription',
    hash: 'sha256',
    signed_payload: '{payload}',
    signature: '$request.header.X-Tracker-Signature',
    prefix: 'sha256=',
    encoding: 'hex',
  },
  filter: {
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
  filter: {
    when: { '$request.body#/type': ['event_callback'], '$request.body#/event/type': ['message'] },
    conversation: '$request.body#/event/channel',
    automatic: '$request.body#/event/bot_id',
  },
  connection: { account: '$request.body#/team_id' },
};

export const overASocket = {
  type: 'websocket',
  open: { method: 'POST', url: 'https://api.chat.example.com/connections.open', address: '/url' },
  credential: 'app_level_token',
  acknowledge: '$message.payload#/envelope_id',
  heartbeat_seconds: 30,
  filter: {
    when: { '$message.payload#/type': ['events_api'] },
    conversation: '$message.payload#/payload/event/channel',
  },
  connection: { account: '$message.payload#/payload/team_id', user: '$message.payload#/payload/event/user' },
};

export const aReplyOverASocket = {
  id: '$message.payload#/payload/event/ts',
  sender: '$message.payload#/payload/event/user',
  text: '$message.payload#/payload/event/text',
  to: '$message.payload#/payload/event/thread_ts',
  time: '$message.payload#/payload/event/ts',
  changed: '$message.payload#/payload/event/hidden',
};

export const overASocketCarryingReplies = carrying(overASocket, aReplyOverASocket);

export const aClickOverASocket = {
  when: { '$message.payload#/type': ['interactive'] },
  conversation: '$message.payload#/payload/channel/id',
  to: '$message.payload#/payload/container/message_ts',
  sender: '$message.payload#/payload/user/id',
  action: '$message.payload#/payload/actions/0/action_id',
  id: '$message.payload#/payload/actions/0/action_ts',
  time: '$message.payload#/payload/actions/0/action_ts',
};

export const overASocketCarryingClicks = {
  ...overASocket,
  filter: { ...overASocket.filter, reply: aReplyOverASocket, click: aClickOverASocket },
};

export const cardMoved = {
  type: 'com.example.boards.card.moved',
  title: 'A card is moved',
  subject: { title: 'Board', required: false },
  data: { type: 'object', properties: { column: { type: 'string' } } },
};

export const overTheBoardsSocket = {
  type: 'websocket',
  open: { method: 'GET', url: 'https://api.boards.example.com/v3/stream', address: '/stream/href' },
  credential: 'app_level_token',
  acknowledge: '$message.payload#/delivery',
  filter: { when: { '$message.payload#/kind': ['card', 'note'] }, conversation: '$message.payload#/board' },
  events: [
    {
      type: cardMoved.type,
      when: { '$message.payload#/kind': ['card'] },
      id: ['$message.payload#/board', '$message.payload#/card/serial'],
      subject: '$message.payload#/board',
      data: { column: '$message.payload#/card/column' },
    },
  ],
  connection: { account: '$message.payload#/space/key' },
};

export const whichSpace = { tool: 'whoami', identified: { id: '/self/uid' }, account: '/self/space' };

export const intoAQueue = {
  type: 'queue',
  per: 'subscription',
  kind: 'azure-event-hubs',
  topic: '{{ sent.conversation }}',
  subscribe: {
    tool: 'create_subscription',
    with: {
      resource: 'chats/{{ topic }}/messages',
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
  filter: { when: { '$message.payload#/changeType': ['created'] }, subscription: '$message.payload#/subscriptionId' },
};

export const inHeadersAndTheQuery = {
  ...ofEachSubscription,
  handshake: {
    when: { '$request.query.hub.mode': ['subscribe', 'unsubscribe'] },
    challenge: '$request.query.hub.challenge',
    signed: false,
  },
  filter: {
    when: { '$request.header.X-Tracker-Event': ['comment', 'review'] },
    subscription: '$request.header.X-Tracker-Hook',
    conversation: '$request.body#/comment/thread',
    automatic: '$request.body#/sender/app',
  },
};

const answeringItsChallenge = {
  ...ofTheApp,
  handshake: { ...ofTheApp.handshake, response: { challenge: 'challenge' } },
};

const aPostsData = { type: 'object', properties: { words: { type: 'string' }, by: { type: 'string' } } };

export const unplacedPostType = { type: 'com.example.chat.post', title: 'A post is made', data: aPostsData };

export const postType = { ...unplacedPostType, subject: { title: 'Room', required: false } };

export const roomType = {
  type: 'com.example.chat.room.opened',
  title: 'A room is opened',
  data: { type: 'object', properties: { name: { type: 'string' } } },
};

export const postTypes = [postType, roomType];

export const aPost = {
  type: 'com.example.chat.post',
  when: { '$request.body#/kind': ['post'] },
  id: ['$request.body#/post/room', '$request.body#/post/seq'],
  time: '$request.body#/post/at',
  subject: '$request.body#/post/room',
  data: { words: '$request.body#/post/words', by: '$request.body#/post/by' },
  automatic: '$request.body#/post/app',
  changed: '$request.body#/post/edit_of',
  own: ['$request.body#/post/by', '$request.body#/installation/member'],
};

export const aRoomOpened = {
  type: 'com.example.chat.room.opened',
  when: { '$request.body#/kind': ['room'] },
  id: ['$request.body#/room/key'],
  data: { name: '$request.body#/room/name' },
};

export function mapping(destination: object, ...events: readonly object[]): Readonly<Record<string, unknown>> {
  return { ...destination, events };
}

export function reporting(
  destinations: readonly unknown[],
  types: readonly unknown[] = postTypes,
): readonly (readonly [string, string])[] {
  return problemsOf({ ...trackerOverASocket, events: { types, destinations } });
}

export const whoItActsAs = {
  method: 'GET',
  url: 'https://api.tracker.example.com/me',
  identified: { id: '/member/key', name: '/member/handle' },
};

export const whoItActsAsThroughATool = { tool: 'whoami', identified: { id: '/self/uid' } };

export function identifying(
  identity: unknown,
  destinations: readonly unknown[],
): readonly (readonly [string, string])[] {
  return problemsOf({ ...trackerOverASocket, events: { types: postTypes, identity, destinations } });
}

export const asSlackSends = carrying(answeringItsChallenge, {
  id: '$request.body#/event/ts',
  sender: '$request.body#/event/user',
  text: '$request.body#/event/text',
  to: '$request.body#/event/thread_ts',
  time: '$request.body#/event/ts',
  changed: '$request.body#/event/hidden',
});
