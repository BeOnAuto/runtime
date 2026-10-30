import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { answers, callingTools, textResult, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  addedConnection,
  aSecretHeader,
  connectedWith,
  connectionsOfAcme,
  linkIn,
} from '../testing/servers/connected-servers.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const crmKey = 'crm-api-key-6e2b9d41';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pendingWords =
  'Nobody has approved the connection crm yet; the person who added it opens its link, or reconnects it for a new link';

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

const refusedAsBroken = { kind: 'credential_refused', detail: keyRefused };

const scopeLacking =
  'The tool server answered HTTP 403: the credential lacks the scope crm.write this request needs; a credential granted that scope would allow it';

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(() => Promise.all(closing.splice(0).map((close) => close())));

async function crmServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: crmKey });
  closing.push(fake.close);
  return fake;
}

function reasoningFunction(tool: string): string {
  return ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tool}]`, '---', 'Summarize acme.'].join('\n');
}

async function serving(...replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  const server = await servingReasoning(replies, connectionsOnLoopback);
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
        { type: 'model_call_started' },
        { type: 'model_call_answered', data: { tool_calls: [{ server: 'crm', tool: 'echo' }] } },
        { type: 'tool_call_started', data: { server: 'crm', connection_id: id, tool: 'echo' } },
        { type: 'tool_call_answered' },
        { type: 'model_call_started' },
        { type: 'model_call_answered' },
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

function searchWords(server: ReasoningServer): Promise<string> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    async (session) => plainTextIn(await session.callTool('search', {})),
  );
}

function callsAt(crm: FakeMcpServer): number {
  return crm.seen().filter(({ rpc }) => rpc === 'tools/call').length;
}

async function standingOf(server: ReasoningServer, id: string): Promise<unknown> {
  return (await server.call('GET', `${connectionsOfAcme}/${id}`)).body;
}

describe('a connection whose server refuses its credential at a call', () => {
  it('is broken by the 401 in its words, once, refused at the next call with no request, and said broken by search', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
    const before = await searchWords(server);
    crm.answerNextOf('tools/call', 401);

    const refused = await executing(server, 'execute');
    const broken = await standingOf(server, id);
    const again = await executing(server, 'execute');
    const after = await searchWords(server);

    expect(before).toMatch(/^This playbook's functions may use 1 tool server\. “crm” offers \d+ tools: /u);
    expect(refused.body).toMatchObject({
      outcome: 'server_failure',
      text: `The tool server crm failed: ${keyRefused}`,
    });
    expect(broken).toMatchObject({ status: 'broken', broken: refusedAsBroken });
    expect(again).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'connection_broken', detail: keyRefused },
    });
    expect(after).toBe(`This playbook's functions may use 1 tool server. “crm” cannot be used: ${keyRefused}.`);
    expect(callsAt(crm)).toBe(1);
  });

  it('is said broken by the search that meets the 401 itself, in the words it records', async () => {
    const crm = await crmServer();
    const server = await serving();
    await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
    crm.answerNextOf('initialize', 401);

    expect(await searchWords(server)).toBe(
      `This playbook's functions may use 1 tool server. “crm” cannot be used: ${keyRefused}.`,
    );
  });
});

describe('a connection whose server refuses a call for a scope its credential lacks', () => {
  it('stays connected, and the call fails in words that name the scope and that a credential granted it would allow it', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
    crm.answerNextOf('tools/call', 403, 1, {
      'www-authenticate': 'Bearer error="insufficient_scope", scope="crm.write"',
    });

    const refused = await executing(server, 'execute');

    expect(refused.body).toMatchObject({
      outcome: 'server_failure',
      text: `The tool server crm failed: ${scopeLacking}`,
    });
    expect(await standingOf(server, id)).toMatchObject({ status: 'connected', broken: null });
  });
});

describe('a connection whose server fails at a call for another reason', () => {
  it('stays connected, as with 500 or 429', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
    crm.answerNextOf('tools/call', 500);
    crm.answerNextOf('tools/call', 429);

    const failed = [await executing(server, 'execute'), await executing(server, 'execute')];

    expect(failed.map(({ body }) => body)).toMatchObject([
      { outcome: 'server_failure' },
      { outcome: 'server_failure' },
    ]);
    expect(await standingOf(server, id)).toMatchObject({ status: 'connected', broken: null });
  });
});

describe('a connection that holds no credential', () => {
  it('is broken by a 401 of its server all the same, in words that say to add it again with a credential', async () => {
    const notes = await serveFakeMcp();
    closing.push(notes.close);
    const server = await serving();
    const { id, token } = await addedConnection(server, {
      name: 'crm',
      type: 'mcp',
      entry: { url: notes.url },
      credential: { kind: 'none' },
    });
    await server.call('POST', `${connectionsOfAcme}/${id}/approve`, { body: { token } });
    notes.answerNextOf('tools/call', 401);

    await executing(server, 'execute');

    const standing = await standingOf(server, id);

    expect(standing).toMatchObject({ status: 'broken', broken: { kind: 'credential_wanted' } });
    expect(JSON.stringify(standing)).toContain('it asks for a credential the connection does not hold, so the person');
  });
});

describe('a connection reconnected', () => {
  it('takes the credential the page gives through its new link, and its server answers again', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), 'Bearer crm-api-key-revoked-0001');
    await executing(server, 'execute');

    const reconnected = await server.call('POST', `${connectionsOfAcme}/${id}/link`);
    const { token } = linkIn(reconnected.body);
    const given = await server.call('POST', `${connectionsOfAcme}/${id}/credential`, {
      body: { token, value: `Bearer ${crmKey}` },
    });
    const executed = await executing(server, 'execute');

    expect(reconnected).toMatchObject({ status: 200, body: { id, status: 'broken', broken: refusedAsBroken } });
    expect(given.body).toMatchObject({ status: 'connected', broken: null, credential_ends_with: '9d41' });
    expect(executed.body).toMatchObject({ outcome: 'result', text: '{"said":"hi"}' });
  });
});
