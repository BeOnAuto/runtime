import { createHmac } from 'node:crypto';

import { serveFakeMcp, type FakeMcpServer, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { onTestFinished, vi } from 'vitest';

import { connectedWith, connectionsIn } from '../servers/connected-servers.ts';
import { connectionsAllowing } from '../servers/loopback-connections.ts';
import type { ServedParts } from '../servers/served-parts.ts';
import { receiptsTold, whenHeld } from '../waiting/until.ts';
import { flatReading } from './chat-readings.ts';
import { servingInteractions, type InteractionServer } from './interaction-server.ts';

export const roomsKey = 'rooms-api-key-7c2d41e9';

export const theWebhookUrl = 'https://events.example.com';

export const theRoom = '#approvals-ada';

/** The account the rooms connection acts as, which its tool `who_am_i` answers. */
export const itsAccountInRooms = 'u-rooms-of-the-connection';

function named(properties: readonly string[]): FakeTool['inputSchema'] {
  return {
    type: 'object',
    properties: Object.fromEntries(properties.map((property) => [property, { type: 'string' }])),
    required: properties,
  };
}

const hookTools: readonly FakeTool[] = [
  {
    name: 'create_hook',
    inputSchema: named(['room', 'callback', 'secret']),
    answer: () => ({ content: [], structuredContent: { hook: { id: 'hook-7' } } }),
  },
  {
    name: 'who_am_i',
    inputSchema: named([]),
    answer: () => ({ content: [], structuredContent: { me: { id: itsAccountInRooms } } }),
  },
];

const subscribedByTool = {
  per: 'subscription',
  topic: '{{ sent.conversation }}',
  subscribe: {
    tool: 'create_hook',
    with: { room: '{{ topic }}', callback: '{{ webhook_url }}', secret: '{{ secret }}' },
    subscribed: { id: '/hook/id' },
  },
  unsubscribe: { tool: 'delete_hook', with: { id: '{{ subscription.id }}' } },
};

export const signedOverTheBody = {
  type: 'webhook',
  ...subscribedByTool,
  verify: {
    scheme: 'hmac',
    secret: 'subscription',
    hash: 'sha256',
    signed_payload: '{payload}',
    signature: '$request.header.X-Rooms-Signature',
    prefix: 'sha256=',
    encoding: 'hex',
  },
  filter: {
    when: { '$request.header.X-Rooms-Event': ['message'] },
    subscription: '$request.header.X-Rooms-Hook',
    conversation: '$request.body#/room',
  },
};

const tokenInAHeader = {
  type: 'webhook',
  ...subscribedByTool,
  verify: { scheme: 'bearer', secret: 'subscription', token: '$request.header.X-Boards-Token' },
  handshake: {
    when: { '$request.query.hub.mode': ['subscribe'] },
    challenge: '$request.query.hub.challenge',
    signed: false,
  },
  filter: { when: { '$request.header.X-Boards-Event': ['card'] }, subscription: '$request.header.X-Boards-Hook' },
};

export function entryOf(name: string, url: string, destination: object) {
  return {
    name,
    title: name,
    description: 'Post to the rooms of a team and read what is said there.',
    website: `https://developer.${name}.example.com`,
    type: 'mcp',
    url,
    credentials: [
      {
        kind: 'secret',
        in: 'header',
        name: 'Authorization',
        scheme: 'Bearer',
        description: 'Token of your team.',
        instructions: 'Make a token under **Settings**.',
        key_page: `https://${name}.example.com/settings/tokens`,
      },
    ],
    events: { destinations: [destination] },
  };
}

export const roomsDelivery: readonly string[] = [
  'deliver:',
  '  server: rooms',
  '  tool: post_message',
  '  with:',
  "    channel: '#approvals-{{ to }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
  ...flatReading,
];

export async function roomsServer(): Promise<FakeMcpServer> {
  const rooms = receiptsTold(await serveFakeMcp({ bearer: roomsKey, chat: true, tools: hookTools }));
  onTestFinished(rooms.close);
  return rooms;
}

export function receivingAt(
  url: string,
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const providers = [entryOf('rooms', url, signedOverTheBody), entryOf('boards', url, tokenInAHeader)];
  return { ...connectionsAllowing(['127.0.0.1'], { providers }), ...environment };
}

export async function servedWithRooms(
  rooms: FakeMcpServer,
  environment: Readonly<Record<string, string>>,
  parts: ServedParts = {},
  org = 'acme',
): Promise<InteractionServer> {
  const server = await servingInteractions(roomsDelivery, receivingAt(rooms.url, environment), parts, org);
  await connectedWith(server, { provider: 'rooms' }, roomsKey, connectionsIn(org));
  await connectedWith(server, { provider: 'boards' }, roomsKey, connectionsIn(org));
  return server;
}

const HookSchema = Schema.Struct({ room: Schema.String, callback: Schema.String, secret: Schema.String });

export type MadeHook = typeof HookSchema.Type;

function hooksMadeAt(rooms: FakeMcpServer) {
  return rooms.received().filter(({ tool }) => tool === 'create_hook');
}

export async function hookMadeAt(rooms: FakeMcpServer): Promise<MadeHook> {
  await whenHeld(
    () => hooksMadeAt(rooms).length,
    (count) => count > 0,
  );
  const [made] = hooksMadeAt(rooms);
  return Schema.decodeUnknownSync(HookSchema)(made?.arguments);
}

const said = JSON.stringify({ room: theRoom, text: 'approve' });

export function signedWith(secret: string, hook = 'hook-7', body = said): Readonly<Record<string, string>> {
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return {
    'content-type': 'application/json',
    'x-rooms-event': 'message',
    'x-rooms-hook': hook,
    'x-rooms-signature': `sha256=${signature}`,
  };
}

export function eventsPathOf(playbook: string, connection: string, org = 'acme'): string {
  return `/v1/orgs/${org}/playbooks/${playbook}/connections/${connection}/events`;
}

export async function delivered(
  server: Pick<InteractionServer, 'origin'>,
  path: string,
  headers: Readonly<Record<string, string>>,
  body = said,
): Promise<string> {
  const answer = await fetch(`${server.origin}${path}`, { method: 'POST', headers, body });
  return `${answer.status} ${await answer.text()}`;
}

export function takenOnceRecorded(
  server: Pick<InteractionServer, 'origin'>,
  hook: MadeHook,
  body = said,
): Promise<string> {
  const { pathname, search } = new URL(hook.callback);
  return whenHeld(
    () => delivered(server, `${pathname}${search}`, signedWith(hook.secret, 'hook-7', body), body),
    (answer) => answer === '200 ',
  );
}

export function loggedLines(): () => readonly string[] {
  const logged = vi.spyOn(console, 'error');
  onTestFinished(() => {
    logged.mockRestore();
  });
  return () => logged.mock.calls.flat().map(String);
}
