import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { chatDelivery } from '@on.auto/interaction/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatKey, chatServer, deliveryHistoryOf } from '../testing/interaction-servers/chat-deliveries.ts';
import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { addedConnection, aSecretHeader, connectedWith } from '../testing/servers/connected-servers.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const decodeStructured = Schema.decodeUnknownSync(Schema.Struct({ structuredContent: Schema.Unknown }));

const pendingWords =
  'Nobody has approved the connection chat yet; the person who added it opens its link, or removes it and adds it again for a new link';

describe('an interaction function that delivers through a connection', () => {
  it('names it at its start, and records the connection beside the server of each delivery', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery);
    const id = await connectedWith(server, aSecretHeader('chat', chat.url), `Bearer ${chatKey}`);

    const runId = await server.ask('approve-brief');
    const facts = await until(
      () => deliveryHistoryOf(server, runId),
      (delivered) => delivered.some(({ type }) => type === 'delivery_succeeded'),
    );

    expect(facts[0]).toMatchObject({
      type: 'delivery_started',
      server: 'chat',
      connection_id: id,
      tool: 'post_message',
    });
    expect(chat.chat.posted()).toMatchObject([{ channel: '#approvals-ada' }]);
  });

  it('is refused at its start while nobody has approved the connection, in its words', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery);
    await addedConnection(server, aSecretHeader('chat', chat.url));

    const refused = await server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
      body: { input: { campaign: 'Spring', owner: 'ada' } },
    });

    expect(refused).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'connection_pending', detail: pendingWords },
    });
    expect(chat.seen()).toEqual([]);
  });
});

describe('the tools of a connection over MCP', () => {
  it('are searched with the connection named, checked by dry_run and called by execute', async () => {
    const chat = await chatServer();
    const server = await servingInteractions();
    const id = await connectedWith(server, aSecretHeader('chat', chat.url), `Bearer ${chatKey}`);
    const onAcme = { url: `${server.origin}/orgs/acme/mcp`, headers: {} };
    const onAlpha = { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} };
    const tool = { server: 'chat', tool: 'echo', arguments: { said: 'hi' } };

    const searched = await withMcpSession('current revision', onAcme, (session) => session.callTool('search', {}));
    const [checked, executed] = await withMcpSession('current revision', onAlpha, async (session) => [
      await session.callTool('dry_run', tool),
      await session.callTool('execute', tool),
    ]);

    expect(decodeStructured(searched).structuredContent).toMatchObject({
      servers: [{ name: 'chat', connection: id, playbooks: ['*'] }],
    });
    expect(decodeStructured(checked).structuredContent).toMatchObject({ would_run: true });
    expect(decodeStructured(executed).structuredContent).toMatchObject({ outcome: 'result', text: '{"said":"hi"}' });
    expect(plainTextIn(searched)).toContain('“chat”, for every playbook,');
  });
});
