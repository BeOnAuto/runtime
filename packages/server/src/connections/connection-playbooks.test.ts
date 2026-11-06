import { answers, callingTools, textResult, toolCallsResult, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { aSecretHeader, connectedWith, connectionsOfAcme } from '../testing/servers/connected-servers.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const crmKey = 'crm-api-key-6e2b9d41';

const firstRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const nextRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const notServingAlpha = {
  reason: 'unavailable',
  kind: 'tool_not_offered',
  because: 'tool_server_not_configured',
  detail: 'No tool server named crm is configured for this playbook',
};

const closing: (() => Promise<void>)[] = [];

afterEach(() => Promise.all(closing.splice(0).map((close) => close())));

async function crmServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: crmKey });
  closing.push(fake.close);
  return fake;
}

const echoingFunction = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [crm/echo]', '---', 'Echo a note.'].join(
  '\n',
);

async function serving(...replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  const server = await servingReasoning(replies, connectionsOnLoopback);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source: echoingFunction, diagram: 'none' },
  });
  return server;
}

function connectedCrm(server: ReasoningServer, crm: FakeMcpServer): Promise<string> {
  return connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
}

function running(server: ReasoningServer, run = firstRun) {
  return server.call('POST', `${alpha}/definitions/reasoning/echo/run`, { body: { input: {}, run_id: run } });
}

function executing(server: ReasoningServer) {
  return server.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, { body: { arguments: { said: 'hi' } } });
}

function settingPlaybooks(server: ReasoningServer, id: string, playbooks: readonly string[] | null) {
  return server.call('PUT', `${connectionsOfAcme}/${id}/playbooks`, { body: { playbooks } });
}

function callsAt(crm: FakeMcpServer): number {
  return crm.seen().filter(({ rpc }) => rpc === 'tools/call').length;
}

const echoedOnce = callingTools([['crm__echo', { said: 'once' }]], answers(textResult('The note was echoed.')));

const echoedTwice = [
  ...callingTools([['crm__echo', { said: 'first' }]], answers(toolCallsResult([['crm__echo', { said: 'second' }]]))),
  answers(textResult('Both notes were echoed.')),
];

describe('a connection given to other playbooks than the one a function runs in', () => {
  it('is answered with the playbooks it serves, and refused to the next run there as it opens its tools, and to a call by hand', async () => {
    const crm = await crmServer();
    const server = await serving();
    const id = await connectedCrm(server, crm);

    const set = await settingPlaybooks(server, id, ['beta']);
    const ran = await running(server);
    const searched = await server.call('GET', `${alpha}/tool-servers/search`);
    const executed = await executing(server);

    expect(set).toMatchObject({ status: 200, body: { id, status: 'connected', entry: { playbooks: ['beta'] } } });
    expect(ran).toMatchObject({ status: 503, body: notServingAlpha });
    expect(searched.body).toMatchObject({ servers: [] });
    expect(executed).toMatchObject({ status: 503, body: notServingAlpha });
    expect(callsAt(crm)).toBe(0);
  });

  it('is left to a run under way, which keeps the tools it opened until it ends', async () => {
    const crm = await crmServer();
    const server = await serving(echoedTwice);
    const id = await connectedCrm(server, crm);
    const release = crm.holdNextOf('tools/call');

    const ran = running(server);
    await until(
      () => callsAt(crm),
      (calls) => calls === 1,
    );
    await settingPlaybooks(server, id, ['beta']);
    release();

    expect(await ran).toMatchObject({ body: { status: 'succeeded', output: 'Both notes were echoed.' } });
    expect(callsAt(crm)).toBe(2);
    expect(await running(server, nextRun)).toMatchObject({ status: 503, body: notServingAlpha });
  });
});

describe('a connection given back to every playbook', () => {
  it('is answered with an entry that names none, and serves the run again', async () => {
    const crm = await crmServer();
    const server = await serving(echoedOnce);
    const id = await connectedCrm(server, crm);
    await settingPlaybooks(server, id, ['beta']);

    const set = await settingPlaybooks(server, id, null);
    const ran = await running(server);

    expect(set).toMatchObject({ status: 200, body: { id, entry: { url: crm.url } } });
    expect(set.body).not.toHaveProperty('entry.playbooks');
    expect(ran.body).toMatchObject({ status: 'succeeded', output: 'The note was echoed.' });
    expect(callsAt(crm)).toBe(1);
  });
});
