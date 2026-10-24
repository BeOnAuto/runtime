import { listedTools, plainTextIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { TimedOut } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  textResult,
  type ScriptedReplies,
  type ScriptedReply,
} from '@on.auto/reasoning/testing';
import { fakeStdioServerPath, serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', 'Summarize acme.'].join(
  '\n',
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

async function serving(
  fake: FakeMcpServer | undefined,
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
): Promise<ReasoningServer> {
  const servers =
    fake === undefined
      ? {}
      : {
          TOOL_SERVERS: JSON.stringify({
            graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
            limitless: {
              command: process.execPath,
              args: [fakeStdioServerPath()],
              env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
              org: 'acme',
            },
          }),
        };
  const server = await servingReasoning(replies, {
    GRAPH_API_KEY: apiKey,
    NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] ?? '',
    ...servers,
    ...environment,
  });
  closing.push(server.stop);
  return server;
}

async function fakeGraph(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function onAlpha<T>(server: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

async function withPlaybook(server: ReasoningServer): Promise<void> {
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
}

async function executedTwice(server: ReasoningServer, document = source) {
  await withPlaybook(server);
  return onAlpha(server, async (session) => {
    await session.callTool('create_definition', { type: 'reasoning', name: 'summary', source: document });
    const running = { type: 'reasoning', name: 'summary', input: {}, run_id: runId };
    const first = await session.callTool('run_definition', running);
    const again = await session.callTool('run_definition', running);
    const history = await session.callTool('list_playbook_events', { run_id: runId, order: 'asc' });
    return { first, again, history };
  });
}

async function annotationsOf(server: ReasoningServer) {
  const listed = listedTools(await onAlpha(server, (session) => session.listTools()));
  return listed.find(({ name }) => name === 'run_definition')?.annotations;
}

const searched = callingTools([['graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));

describe('run_definition over MCP on a server with tool servers', () => {
  it('is destructive when a tool server is configured or people may add connections, so an assistant asks before running a function', async () => {
    const configured = await serving(await fakeGraph(), []);
    const takingConnections = await serving(undefined, []);
    const neither = await serving(undefined, [], { CONNECTIONS: JSON.stringify({ people_may_add: false }) });

    expect(await annotationsOf(configured)).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(await annotationsOf(takingConnections)).toMatchObject({ destructiveHint: true });
    expect(await annotationsOf(neither)).toMatchObject({ destructiveHint: false });
  });

  it('runs a reasoning function with its tools, whose history shows the calls', async () => {
    const fake = await fakeGraph();
    const { first, history } = await executedTwice(await serving(fake, [searched]));

    expect(first.structuredContent).toMatchObject({ status: 'succeeded', output: 'Acme has 2 rows.' });
    expect(history.structuredContent).toMatchObject({
      events: [
        { type: 'run_started' },
        { type: 'model_call_started', data: { number: 1, tools_offered: 1 } },
        {
          type: 'model_call_answered',
          data: { number: 1, finish_reason: 'tool_calls', tool_calls: [{ server: 'graph', tool: 'search' }] },
        },
        { type: 'tool_call_started', data: { server: 'graph', tool: 'search' } },
        { type: 'tool_call_answered', data: { is_error: false, answer: 'Found 2 rows for acme.' } },
        { type: 'model_call_started', data: { number: 2 } },
        { type: 'model_call_answered', data: { number: 2, finish_reason: 'stop', tool_calls: [] } },
        { type: 'run_succeeded' },
      ],
    });
  });
});

describe('a reasoning function with tools over MCP', () => {
  it('runs a reasoning function with the tools of a process the server starts', async () => {
    const reply = callingTools([['limitless__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));
    const processSource = source.replace('graph/search', 'limitless/search');

    const { first, history } = await executedTwice(await serving(await fakeGraph(), [reply]), processSource);

    expect(first.structuredContent).toMatchObject({ status: 'succeeded', output: 'Acme has 2 rows.' });
    expect(history.structuredContent).toMatchObject({
      events: [
        { type: 'run_started' },
        { type: 'model_call_started', data: { number: 1, tools_offered: 1 } },
        {
          type: 'model_call_answered',
          data: { number: 1, finish_reason: 'tool_calls', tool_calls: [{ server: 'limitless', tool: 'search' }] },
        },
        { type: 'tool_call_started', data: { server: 'limitless', tool: 'search' } },
        { type: 'tool_call_answered', data: { is_error: false, answer: 'Found 2 rows for acme.' } },
        { type: 'model_call_started', data: { number: 2 } },
        { type: 'model_call_answered', data: { number: 2, finish_reason: 'stop', tool_calls: [] } },
        { type: 'run_succeeded' },
      ],
    });
  });
});

describe('the words of a reasoning run over MCP that could not finish after calling tools', () => {
  it('says in plain words that a run whose tools only read may run again, though not under its id', async () => {
    const fake = await fakeGraph();
    const { first, again } = await executedTwice(
      await serving(fake, [callingTools([['graph__search', { query: 'acme' }]], timedOut)]),
    );

    expect(plainTextIn(first)).toBe(
      "Could not run the reasoning function “summary”: it called tools but could not finish, because the model stopped answering. Nothing was changed. Every tool it called only reads, by its server's own account, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.",
    );
    expect(plainTextIn(again)).toBe(
      "Could not run the reasoning function “summary”: an attempt of this run under the same id did not succeed, and every tool it called only reads, by its server's own account. Nothing was changed. So it was not run again under its id: start a new run instead; its history shows what it called.",
    );
    expect(fake.received()).toHaveLength(1);
  });

  it('says in plain words that a run whose tool may have changed something is not run again by itself', async () => {
    const fake = await fakeGraph();
    const { first, again } = await executedTwice(
      await serving(fake, [callingTools([['graph__echo', { said: 'acme' }]], timedOut)]),
      source.replace('graph/search', 'graph/echo'),
    );

    expect(plainTextIn(first)).toBe(
      'Could not run the reasoning function “summary”: it could not finish after calling a tool that may change something, so whether that happened is not known, because the model stopped answering. It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.',
    );
    expect(plainTextIn(again)).toMatch(
      /^Could not run the reasoning function “summary”: this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something\. So it was not run again/u,
    );
    expect(fake.received()).toHaveLength(1);
  });
});
