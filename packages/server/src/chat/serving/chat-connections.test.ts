import type { SocketHolder } from '@on.auto/connections';
import { eventDestinationOf } from '@on.auto/providers';
import { Effect, Option, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { shippedProviders } from '../../testing/chat/shipped-slack-bot.ts';
import { slackChatRenderingForTests } from '../../testing/chat/slack-chat-rendering.ts';
import { answeredWith } from '../../testing/sockets/held-sockets.ts';
import type { ChatCalls } from '../service/service-calls.ts';
import { ChatConnections, type ConnectionsComposing } from './chat-connections.ts';
import { namesOf } from './chat-names.ts';

const slackHolder: SocketHolder = {
  connection: 'connection-1',
  name: 'slack',
  connectedAt: '2026-11-19T08:00:00.000Z',
  provider: 'slack-bot',
  at: 0,
  destination: Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(shippedProviders, 'slack-bot', 'websocket'))),
  credential: 'app_level_token',
  label: 'Slack app-level token',
  secretId: 'secret-1',
  account: 'T1',
  accountName: 'Acme',
  identityOwed: false,
  model: 'provider/model',
};

const thePerson = { ok: true, ts: '1700.3', user: { team_id: 'T1', real_name: 'Dana Reyes', profile: {} } };

type ConnectionCall = Parameters<ChatCalls['callAsTheConnection']>[0];

function callsAsTheConnection() {
  const calls: ConnectionCall[] = [];
  const tools: ChatCalls = {
    callAsTheConnection: (call) =>
      Effect.sync(() => {
        calls.push(call);
        return answeredWith(thePerson);
      }),
    mostRequestBytesTo: () => 65_536,
  };
  return { tools, calls };
}

const twoPlaybooks = [
  { org: 'acme', playbook: 'pb-1' },
  { org: 'acme', playbook: 'pb-2' },
] as const;

function composingWith(
  held: readonly SocketHolder[],
  sentAs = false,
  playbooks: Effect.Success<ReturnType<ConnectionsComposing['playbooks']>> = twoPlaybooks,
): ConnectionsComposing {
  return {
    held: () => Effect.succeed(held),
    playbooks: () => Effect.succeed(playbooks),
    providers: shippedProviders,
    requests: {
      awaited: () => Effect.succeed({ awaited: sentAs, typing: false }),
      waitingIn: () => Effect.succeed(sentAs ? [{ org: 'acme', playbook: 'pb-1' }] : []),
    },
  };
}

const member = { org: 'acme', holder: slackHolder };

describe('the connection a chat answers through', () => {
  it('is the connection held now, with the entry’s chat and render target', async () => {
    const connections = new ChatConnections(composingWith([slackHolder], true), callsAsTheConnection().tools);
    const connection = await connections.connectionOf(member);
    connection?.notShownHere.add();

    expect([
      connection?.render.service,
      connection?.model,
      connection?.accountName,
      await connection?.requestSentAs('C1', '1700.1'),
      await connection?.requestWaitsIn('C1'),
      connection?.notShownHere.has(),
    ]).toEqual(['Slack', 'provider/model', 'Acme', true, true, true]);
  });

  it.each([
    ['no playbook', []],
    ['playbooks', twoPlaybooks],
  ] as const)(
    'answers a member through the connection itself on a server with %s, naming no playbook in any call',
    async (_, playbooks) => {
      const { tools, calls } = callsAsTheConnection();
      const connections = new ChatConnections(composingWith([slackHolder], false, playbooks), tools);
      const connection = await connections.connectionOf(member);
      const where = { id: '1700.2', conversation: 'C1', thread: undefined, sender: 'U1', kind: 'mention' };

      expect([
        await connection?.service.answered(where, 'Sales are up.'),
        (await connection?.service.sender(where))?.name,
        await connection?.service.typing(where),
      ]).toEqual(['1700.3', 'Dana Reyes', 'shown']);
      expect(calls.map((call) => [Object.keys(call).toSorted(), call.org, call.connection, call.tool])).toEqual([
        [['connection', 'input', 'org', 'tool'], 'acme', 'connection-1', 'chat_postMessage'],
        [['connection', 'input', 'org', 'tool'], 'acme', 'connection-1', 'users_info'],
        [['connection', 'input', 'org', 'tool'], 'acme', 'connection-1', 'assistant_threads_setStatus'],
      ]);
    },
  );

  it.each([
    ['held no longer', []],
    ['of an entry with no chat', [{ ...slackHolder, provider: 'github' }]],
    ['of no account', [Struct.omit(slackHolder, ['account'])]],
  ] as const)('is none where the connection is %s', async (_, held) => {
    const connections = new ChatConnections(composingWith(held), callsAsTheConnection().tools);

    expect(await connections.connectionOf(member)).toBeUndefined();
  });
});

describe('the names a link page shows', () => {
  it('are the service’s and the app’s by the account, and the member’s and the account’s as the service names them', async () => {
    const names = namesOf(new ChatConnections(composingWith([slackHolder]), callsAsTheConnection().tools));

    expect([
      await names.ofTheService('T1'),
      await names.ofTheMember({ account: 'T1', member: 'U1' }),
      await names.ofTheService('T9'),
      await names.ofTheMember({ account: 'T9', member: 'U1' }),
    ]).toEqual([
      { service: 'Slack', app: 'Auto' },
      { memberName: 'Dana Reyes', accountName: 'Acme' },
      undefined,
      undefined,
    ]);
  });

  it('name the account as the service where the service named no account', async () => {
    const unnamed = new ChatConnections(
      composingWith([Struct.omit(slackHolder, ['accountName'])]),
      callsAsTheConnection().tools,
    );

    expect(await namesOf(unnamed).ofTheMember({ account: 'T1', member: 'U1' })).toEqual({
      memberName: 'Dana Reyes',
      accountName: slackChatRenderingForTests.service,
    });
  });
});
