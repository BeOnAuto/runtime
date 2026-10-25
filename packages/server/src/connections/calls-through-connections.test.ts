import { answers, callingTools, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  addedConnection,
  aSecretHeader,
  connectedWith,
  connectionsOfAcme,
} from '../testing/servers/connected-servers.ts';
import {
  alpha,
  servingReasoning,
  type ReasoningServer,
  connectionsReachingTheLoopback,
} from '../testing/servers/reasoning-server.ts';

const crmKey = 'crm-api-key-6e2b9d41';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pendingWords =
  'Nobody has approved the connection crm yet; the person who added it opens its link, or removes it and adds it again for a new link';

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function crmServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: crmKey });
  closing.push(fake.close);
  return fake;
}

function reasoningFunction(tool: string): string {
  return ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tool}]`, '---', 'Summarize acme.'].join('\n');
}

async function serving(...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const server = await servingReasoning(replies, { CONNECTIONS: connectionsReachingTheLoopback() });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source: reasoningFunction('crm/echo') },
  });
  return server;
}

function running(server: ReasoningServer) {
  return server.call('POST', `${alpha}/definitions/reasoning/echo/run`, { body: { input: {}, run_id: runId } });
}

async function historyRead(server: ReasoningServer) {
  const page = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const wholes = await Promise.all(
    decodeEvents(page.body).events.map(async ({ id }) => (await server.call('GET', `${alpha}/events/${id}`)).body),
  );
  return { page: page.body, wholes };
}

const echoedTheKey = callingTools(
  [['crm__echo', { note: `the key is ${crmKey}` }]],
  answers(textResult('The note was echoed.')),
);

function executing(server: ReasoningServer, path: string) {
  return server.call('POST', `${alpha}/tool-servers/crm/tools/echo/${path}`, { body: { arguments: { said: 'hi' } } });
}

describe('a function that names a connection a person added and gave its credential through its link', () => {
  it('calls its tool with the credential in the header, which no page, no event and no line of the log holds', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const crm = await crmServer();
    const server = await serving(echoedTheKey);
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);

    const searched = await server.call('GET', `${alpha}/tool-servers/search`);
    const ran = await running(server);
    const { page, wholes } = await historyRead(server);

    expect(searched.body).toMatchObject({ servers: [{ name: 'crm', type: 'mcp', connection: id }] });
    expect(ran.body).toMatchObject({ status: 'succeeded', output: 'The note was echoed.' });
    expect(page).toMatchObject({
      events: [
        { type: 'run_started' },
        { type: 'tool_call_started', data: { server: 'crm', connection_id: id, tool: 'echo' } },
        { type: 'tool_call_answered' },
        { type: 'run_succeeded' },
      ],
    });
    expect(crm.seen().every(({ authorization }) => authorization === `Bearer ${crmKey}`)).toBe(true);
    expect(JSON.stringify([searched.body, ran.body, page, wholes, logged.mock.calls])).not.toContain(crmKey);
  });
});

describe('the tools of a connection called by hand', () => {
  it('are checked by dry_run and called by execute, which records the connection beside its server', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);

    const checked = await executing(server, 'dry-run');
    const executed = await executing(server, 'execute');
    const events = await server.call('GET', `${alpha}/events?type=tool_call_started`);

    expect(checked.body).toMatchObject({ would_run: true, allowed: true, server: { reachable: 'yes' } });
    expect(executed.body).toMatchObject({ server: 'crm', tool: 'echo', outcome: 'result', text: '{"said":"hi"}' });
    expect(events.body).toMatchObject({ events: [{ data: { server: 'crm', connection_id: id, tool: 'echo' } }] });
  });
});

describe('a function that names a connection nobody has approved yet', () => {
  it('is refused in the words of the connection, which search lists unavailable, and nothing is sent', async () => {
    const crm = await crmServer();
    const server = await serving();
    await addedConnection(server, aSecretHeader('crm', crm.url));

    const ran = await running(server);
    const searched = await server.call('GET', `${alpha}/tool-servers/search`);

    expect(ran).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'connection_pending', detail: pendingWords },
    });
    expect(searched.body).toMatchObject({
      servers: [{ name: 'crm', because: 'connection_pending', unavailable: pendingWords }],
    });
    expect(crm.seen()).toEqual([]);
  });
});

describe('a connection removed', () => {
  it('leaves the next listing, and the next call through it is refused', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
    await executing(server, 'execute');

    await server.call('DELETE', `${connectionsOfAcme}/${id}`);

    expect((await server.call('GET', `${alpha}/tool-servers/search`)).body).toMatchObject({ servers: [] });
    expect(await executing(server, 'execute')).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'tool_server_not_configured' },
    });
  });
});
