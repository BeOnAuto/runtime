import type { ConnectionEventSchema } from '@on.auto/connections';
import type { Decided } from '@on.auto/operations';
import { eventDestinationOf, providerFoundBy } from '@on.auto/providers';
import {
  cardMoved,
  ledgers,
  overASocket,
  overASocketCarryingReplies,
  overTheBoardsSocket,
  providersOf,
  trackerOverASocket,
  whichSpace,
} from '@on.auto/providers/testing';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect, Function, Option, Struct } from 'effect';

import type { SocketMember } from '../../sockets/socket-registries.ts';

export type Fact = Decided<typeof ConnectionEventSchema.Type>;

export type ServiceAnswer = CalledOnce;

export const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

export const connectedAt = '2026-11-19T08:00:00.000Z';

const [aKey] = trackerOverASocket.credentials;

/** How the cards entry asks who a connection is: an HTTP request, not a tool of the connection. */
const whoAmIByRequest = { method: 'GET', url: 'https://api.tracker.example.com/me', identified: { id: '/self/uid' } };

const typingWith = {
  channel: '{{ sent.conversation }}',
  thread: '{{ reply.to }}',
  to: '{{ to }}',
  status: 'is working',
};

/** How the chats entry replies in a conversation, and shows a person that Auto is working on their reply. */
const chatsConversations = {
  tell: 'all',
  reply: { tool: 'post_message', with: { channel: '{{ sent.conversation }}', text: '{{ message }}' }, sent: '/ts' },
  typing: { tool: 'set_status', with: typingWith },
};

/**
 * Made-up entries whose connections hold a socket: the tracker's and the ledgers', which report no event and say
 * nothing of who a connection is; the boards', of another shape, which maps a card moved to an event, names the
 * space a message is in, and says how to ask who a connection is and which space it is in; the chats', whose
 * messages carry the reply a person writes in the thread of a message, and which shows that Auto is working on it;
 * the chats' over an HTTP API, whose failed answers name a code, and which lists the codes of a service that shows
 * no working status in an account: one it answers as an error, and every code of a refused key; and the cards', of the
 * boards' shape, which asks who a connection is by an HTTP request.
 */
export const socketProviders = providersOf(
  { ...trackerOverASocket, events: { destinations: [overASocket] } },
  {
    ...Struct.omit(ledgers, ['headers', 'placeholders']),
    base_url: 'https://api.ledgers.example.com/v2',
    credentials: [aKey],
    events: { destinations: [overASocket] },
    failure_codes: failureCodes,
  },
  {
    ...trackerOverASocket,
    name: 'boards',
    title: 'Boards',
    events: { types: [cardMoved], identity: whichSpace, destinations: [overTheBoardsSocket] },
  },
  {
    ...trackerOverASocket,
    name: 'chats',
    title: 'Chats',
    events: { destinations: [overASocketCarryingReplies] },
    conversations: chatsConversations,
  },
  {
    ...Struct.omit(ledgers, ['headers', 'placeholders']),
    name: 'chats-api',
    title: 'Chats API',
    base_url: 'https://api.chats.example.com/v1',
    credentials: [aKey],
    failure_codes: failureCodes,
    conversations: {
      ...chatsConversations,
      typing: { tool: 'set_status', with: typingWith, refused: ['feature_disabled', 'invalid_auth'] },
    },
  },
  {
    ...trackerOverASocket,
    name: 'cards',
    title: 'Cards',
    events: { types: [cardMoved], identity: whoAmIByRequest, destinations: [overTheBoardsSocket] },
  },
);

const chatsSocket = Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(socketProviders, 'chats', 'websocket')));

/** The connection named chat, through which the chat harness sends its request, of an entry, in a workspace. */
export function chatMemberIn(workspace: string, provider: string): SocketMember {
  const codes = Option.getOrThrow(Option.fromNullishOr(providerFoundBy(socketProviders, provider))).entry.failure_codes;
  return {
    org: 'acme',
    holder: {
      connection: 'connection-chat',
      name: 'chat',
      connectedAt,
      provider,
      at: 0,
      destination: chatsSocket,
      credential: 'app_level_token',
      label: 'Chat app-level token',
      secretId: 'chats',
      account: workspace,
      identityOwed: false,
      model: null,
      ...(codes === undefined ? {} : { failureCodes: codes }),
    },
  };
}

export function heldBy(
  connection: string,
  appSecretId?: string,
  provider = 'tracker',
  name = `chat-${connection}`,
): readonly Fact[] {
  return [
    {
      type: 'connection_added',
      data: {
        connection,
        name,
        server_type: 'mcp',
        provider,
        placeholders: null,
        entry: { url: 'https://tracker.example.com/mcp' },
        credential: { kind: 'secret', name: 'Authorization', in: 'header' },
        says: {},
        added_by: { id: 'person:ada', name: 'Ada' },
      },
    },
    {
      type: 'connection_connected',
      data: {
        connection,
        secret_id: `key-${connection}`,
        app_secret_ids: appSecretId === undefined ? {} : { app_level_token: appSecretId },
        connected_by: { id: 'person:ada', name: 'Ada' },
      },
    },
  ];
}

/** A connection of the boards entry holding the app credential that opens its socket, recorded in a space if given. */
export function inSpace(connection: string, appSecretId: string, space?: string): readonly Fact[] {
  const identified: readonly Fact[] =
    space === undefined
      ? []
      : [
          {
            type: 'connection_identified',
            data: { connection, connected_at: connectedAt, user: { id: `B-${connection}` }, account: { id: space } },
          },
        ];
  return [...heldBy(connection, appSecretId, 'boards'), ...identified];
}

/** A connection of the cards entry holding the app credential that opens its socket. */
export function inCards(connection: string, appSecretId: string): readonly Fact[] {
  return heldBy(connection, appSecretId, 'cards');
}

/**
 * The connection named chat, through which a request of the interaction's chat harness is sent, holding the app
 * credential that opens the chats socket, recorded in a workspace if given.
 */
export function chatIn(workspace?: string): readonly Fact[] {
  const identified: readonly Fact[] =
    workspace === undefined
      ? []
      : [
          {
            type: 'connection_identified',
            data: {
              connection: 'connection-chat',
              connected_at: connectedAt,
              user: { id: 'B0CHAT' },
              account: { id: workspace },
            },
          },
        ];
  return [...heldBy('connection-chat', 'chats', 'chats', 'chat'), ...identified];
}

/** The connection connected again, holding the app credential that opens the boards socket. */
export function connectedAgain(connection: string, appSecretId: string): Fact {
  return {
    type: 'connection_connected',
    data: {
      connection,
      secret_id: `key-${connection}`,
      app_secret_ids: { app_level_token: appSecretId },
      connected_by: { id: 'person:ada', name: 'Ada' },
    },
  };
}

export function inTheChannel(channel: string): object {
  return {
    type: 'events_api',
    envelope_id: `e-${channel}`,
    payload: { team_id: 'T1', event: { channel, user: 'U1' } },
  };
}

export const theCardMoved = { type: cardMoved.type, id: 'B1/7', subject: 'B1', data: { column: 'Done' } };

export function theCardMovedAs(serial: number): typeof theCardMoved {
  return { ...theCardMoved, id: `B1/${serial}` };
}

/** A message of the boards socket that a card moved, in a space if given: an event, and a wake for its board. */
export function aCardMovedIn(space: string | undefined, serial: number): object {
  const placed = space === undefined ? {} : { space: { key: space } };
  return { delivery: `d-${serial}`, kind: 'card', board: 'B1', ...placed, card: { serial, column: 'Done' } };
}

/** A message of the boards socket that wakes its board and reports no event. */
export function aNoteIn(space: string, serial: number): object {
  return { delivery: `d-${serial}`, kind: 'note', board: 'B1', space: { key: space } };
}

export function answeredWith(document: object): ServiceAnswer {
  return {
    kind: 'answered',
    mark: 'reads',
    detail: '',
    retryAfterMs: null,
    outcome: 'result',
    answer: { content: [], structuredContent: { ...document } },
    answered: { is_error: false, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
  };
}

export const unreachable: ServiceAnswer = {
  kind: 'unopened',
  refused: 'tool_server_failed',
  because: 'unreachable',
  detail: '',
};

export const noSecretsKept = {
  keep: Function.constant(Effect.die('a secret was kept')),
  read: Function.constant(Effect.die('a secret was read')),
  forget: Function.constant(Effect.die('a secret was forgotten')),
};
