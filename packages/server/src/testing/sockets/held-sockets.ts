import type { ConnectionEventSchema } from '@on.auto/connections';
import type { Decided } from '@on.auto/operations';
import type { ThroughTheConnection } from '@on.auto/providers';
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
import { Effect, Function, Struct } from 'effect';
import { TestClock } from 'effect/testing';

export type Fact = Decided<typeof ConnectionEventSchema.Type>;

export type ServiceAnswer = CalledOnce;

export const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

export const connectedAt = '2026-11-19T08:00:00.000Z';

const [aKey] = trackerOverASocket.credentials;

/**
 * Made-up entries whose connections hold a socket: the tracker's and the ledgers', which report no event and say
 * nothing of who a connection is; the boards', of another shape, which maps a card moved to an event, names the
 * space a message is in, and says how to ask who a connection is and which space it is in; and the chats', whose
 * messages carry the reply a person writes in the thread of a message.
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
  { ...trackerOverASocket, name: 'chats', title: 'Chats', events: { destinations: [overASocketCarryingReplies] } },
);

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

interface Answering {
  readonly answers: ReadonlyMap<string, ServiceAnswer>;
  readonly lateBy: ReadonlyMap<string, number>;
  readonly asked: (connection: string) => void;
}

/**
 * The tools of the connections, answering the call that asks who a connection is as told by the connection's name,
 * after the time it is late by on the test's clock.
 */
export function answeringBy({ answers, lateBy, asked }: Answering): ThroughTheConnection {
  const late = (connection: string) => {
    const by = lateBy.get(connection);
    return by === undefined ? Effect.void : TestClock.adjust(by);
  };
  return {
    callOnce: ({ reference }) =>
      Effect.andThen(
        late(reference.server),
        Effect.sync(() => {
          asked(reference.server);
          return answers.get(reference.server) ?? answeredWith({ self: { uid: `B-${reference.server}` } });
        }),
      ),
    requestOnce: Function.constant(Effect.die('a request was sent')),
    mostRequestBytesTo: () => 1_048_576,
  };
}

export const noSecretsKept = {
  keep: Function.constant(Effect.die('a secret was kept')),
  read: Function.constant(Effect.die('a secret was read')),
  forget: Function.constant(Effect.die('a secret was forgotten')),
};
