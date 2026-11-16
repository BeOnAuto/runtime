import { plainTextIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { beforeGoingOnOf } from '@on.auto/operations';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const naming = (tools: string) =>
  ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tools}]`, '---', 'Judge acme.'].join('\n');

const readsOnly =
  'Its tools are all marked reads: graph/search and graph/profile. Choosing what to search, what to open or which hits to read is not exploring: a reasoning function with no tools chooses, and lookups search and read each choice in a `for`. Keep the tools only if its next search depends on what it just read. Move the reads now, or tell the person what it searches for after a read.';

const notice = { kind: 'tools_only_read', detail: readsOnly, at: '/tools', certainty: 'likely' };

async function serving(): Promise<{ readonly server: ReasoningServer; readonly fake: FakeMcpServer }> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const searched = callingTools([['graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));
  const server = await servingReasoning([searched], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, async (session) => {
    await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' });
    await session.callTool('create_playbook', { playbook: 'beta', name: 'Beta' });
  });
  await onAlpha(server, (session) => session.callTool('create_definition', saving('earlier', '')));
  return { server, fake };
}

function onPlaybook<T>(
  server: ReasoningServer,
  playbook: string,
  use: (session: McpSession) => Promise<T>,
): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/${playbook}/mcp`, headers: {} },
    use,
  );
}

function onAlpha<T>(server: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return onPlaybook(server, 'alpha', use);
}

function saving(name: string, tools: string) {
  return { type: 'reasoning', name, source: naming(tools), diagram: 'none' };
}

describe('a reasoning function whose tools are all marked reads, saved over MCP', () => {
  it('is saved, and its answer carries its words first, then the notice with what to do with it, said once', async () => {
    const { server } = await serving();

    const { created, updated } = await onAlpha(server, async (session) => ({
      created: await session.callTool('create_definition', saving('judge', 'graph/search, graph/profile')),
      updated: await session.callTool('update_definition', {
        ...saving('judge', 'graph/search, graph/profile'),
        source: `${naming('graph/search, graph/profile')}\nBe brief.`,
      }),
    }));

    expect([created.structuredContent, updated.structuredContent]).toMatchObject([
      { name: 'judge', version: 1, notices: [notice], before_going_on: beforeGoingOnOf(1) },
      { name: 'judge', version: 2, notices: [notice], before_going_on: beforeGoingOnOf(1) },
    ]);
    expect(
      [created, updated].map(({ structuredContent }) => Object.keys({ ...structuredContent }).slice(0, 3)),
    ).toEqual([
      ['in_words', 'notices', 'before_going_on'],
      ['in_words', 'notices', 'before_going_on'],
    ]);
    expect(plainTextIn(created)).toMatch(/^Created the reasoning function “judge”\./u);
    expect([created, updated].map(({ content }) => content[1]?.text.startsWith('{"notices":[{'))).toEqual([true, true]);
    expect([created, updated].map(({ structuredContent }) => structuredContent?.['in_words'])).toEqual([
      plainTextIn(created),
      plainTextIn(updated),
    ]);
    expect([plainTextIn(created), plainTextIn(updated)].some((text) => text.includes(beforeGoingOnOf(1)))).toBe(false);
  });
});

describe('a reasoning function whose tools are all marked reads, saved over MCP as the first definition of a playbook', () => {
  it('is answered with the notice of its tools, then the reminder to have the design agreed, and what to do with both', async () => {
    const { server } = await serving();

    const created = await onPlaybook(server, 'beta', (session) =>
      session.callTool('create_definition', saving('judge', 'graph/search, graph/profile')),
    );

    expect(created.structuredContent).toMatchObject({
      name: 'judge',
      version: 1,
      notices: [notice, { kind: 'first_definition', certainty: 'reminder' }],
      before_going_on: beforeGoingOnOf(2),
    });
  });
});

describe('a reasoning function that names a tool which may act, or of a server not configured, saved over MCP', () => {
  it('is saved without a notice', async () => {
    const { server } = await serving();

    const answered = await onAlpha(server, async (session) => [
      await session.callTool('create_definition', saving('acting', 'graph/search, graph/echo')),
      await session.callTool('create_definition', saving('elsewhere', 'graph/search, other/search')),
    ]);

    expect(answered.map(({ structuredContent }) => structuredContent)).toMatchObject([
      { name: 'acting', version: 1 },
      { name: 'elsewhere', version: 1 },
    ]);
    expect(JSON.stringify(answered)).not.toContain('notices');
  });
});

describe('a reasoning function whose tools are all marked reads, run over MCP', () => {
  it('is run, when the agent asks, with its words and the same notice first in its answer, and what to do with it', async () => {
    const { server } = await serving();

    const ran = await onAlpha(server, async (session) => {
      await session.callTool('create_definition', saving('judge', 'graph/search, graph/profile'));
      return session.callTool('run_definition', { type: 'reasoning', name: 'judge', input: {} });
    });

    expect(ran.structuredContent).toMatchObject({
      status: 'succeeded',
      notices: [notice],
      before_going_on: beforeGoingOnOf(1),
    });
    expect(ran.content[1]?.text.startsWith('{"notices":[{')).toBe(true);
    expect(Object.keys({ ...ran.structuredContent }).slice(0, 3)).toEqual(['in_words', 'notices', 'before_going_on']);
    expect(ran.structuredContent?.['in_words']).toBe(plainTextIn(ran));
    expect(plainTextIn(ran)).not.toContain(beforeGoingOnOf(1));
  });
});

describe('a reasoning function whose tool server does not list its tools in time, saved over MCP', () => {
  it('is saved within the two seconds the notices may take, without a notice', async () => {
    const { server, fake } = await serving();
    const release = fake.holdNextOf('tools/list');
    const started = performance.now();

    const created = await onAlpha(server, (session) =>
      session.callTool('create_definition', saving('judge', 'graph/search, graph/profile')),
    );
    const took = performance.now() - started;
    release();

    expect(created.structuredContent).toMatchObject({ name: 'judge', version: 1 });
    expect(JSON.stringify(created)).not.toContain('notices');
    expect(took).toBeGreaterThanOrEqual(2_000);
    expect(took).toBeLessThan(3_000);
  });
});
