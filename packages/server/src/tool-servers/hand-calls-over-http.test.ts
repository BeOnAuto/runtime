import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
}

async function serving(): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingReasoning([], {
    API_KEYS: JSON.stringify([builder.entry, reader.entry]),
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
        org: 'acme',
      },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: builder.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return { server, graph };
}

function executeOf(server: ReasoningServer, tool: string, body: unknown = {}, key = builder.key) {
  return server.call('POST', `${alpha}/tool-servers/graph/tools/${tool}/execute`, { key, body });
}

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const aCallId: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/u);

const aNumber: unknown = expect.any(Number);

describe('execute over HTTP', () => {
  it('calls a tool, whether its server marks it read-only or not, answering what a run’s model would see', async () => {
    const { server, graph } = await serving();

    const read = await executeOf(server, 'search', { arguments: { query: 'acme' } });
    const written = await executeOf(server, 'echo', { arguments: { said: 'hello' } });

    expect(read).toMatchObject({
      status: 200,
      body: {
        call_id: aCallId,
        server: 'graph',
        tool: 'search',
        outcome: 'result',
        text: 'Found 2 rows for acme.',
        result_bytes: aNumber,
        duration_ms: aNumber,
      },
    });
    expect(written).toMatchObject({ status: 200, body: { outcome: 'result', text: '{"said":"hello"}' } });
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(graph.received()).toMatchObject([{ tool: 'search' }, { tool: 'echo' }]);
  });

  it('answers a server that cannot be used as a problem retried later, and a tool it is not offered as one that is not', async () => {
    const { server, graph } = await serving();

    graph.answerNextWith(503);
    const failing = await executeOf(server, 'search', { arguments: { query: 'acme' } });
    const unlisted = await executeOf(server, 'lookup');

    expect(failing).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'tool_server_failed', because: 'failing' },
    });
    expect(failing.headers.get('retry-after')).toBe('5');
    expect(unlisted).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed' },
    });
    expect(unlisted.headers.get('retry-after')).toBeNull();
    expect(graph.received()).toEqual([]);
  });
});

describe('who may execute a tool over HTTP, and what the answer leaves out', () => {
  it('refuses a key that may only read, even for a tool that only reads, and a retired playbook, and shows no secret', async () => {
    const { server, graph } = await serving();

    const read = await executeOf(server, 'search', { arguments: { query: 'acme' } }, reader.key);
    const called = await executeOf(server, 'search', { arguments: { query: 'acme' } });
    await server.call('POST', `${alpha}/retire`, { key: builder.key });
    const retired = await executeOf(server, 'search', { arguments: { query: 'acme' } });
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    const text = JSON.stringify([called.body, events.body]);

    expect(read).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(retired).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'retired' } });
    expect(graph.received()).toHaveLength(1);
    expect([apiKey, 'production-eu', 'Bearer', graph.url].filter((secret) => text.includes(secret))).toEqual([]);
  });
});

describe('what a call made by hand records in the history of the playbook', () => {
  it('shows a start and an answer in the events of the playbook, by type, beside the calls of runs, and in the history of no run', async () => {
    const { server } = await serving();

    await executeOf(server, 'search', { arguments: { query: 'acme' } });
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    const starts = await server.call('GET', `${alpha}/events?type=tool_call_started`, { key: builder.key });
    const answers = await server.call('GET', `${alpha}/events?type=tool_call_answered`, { key: builder.key });
    const runs = await server.call('GET', `${alpha}/runs`, { key: builder.key });

    expect(events.body).toMatchObject({
      events: [
        {
          type: 'tool_call_started',
          summary: 'Someone allowed to change the playbook called the search tool of graph by hand.',
          data: { server: 'graph', tool: 'search', arguments: { query: 'acme' } },
          metadata: { causation_id: null, by: 'acme-builder' },
        },
        {
          type: 'tool_call_answered',
          summary: 'The tool answered.',
          data: { is_error: false, answer: 'Found 2 rows for acme.' },
        },
      ],
    });
    expect([starts.body, answers.body]).toMatchObject([
      { events: [{ type: 'tool_call_started' }] },
      { events: [{ type: 'tool_call_answered' }] },
    ]);
    expect(runs.body).toMatchObject({ runs: [] });
  });
});

describe('what a call made by hand does not record', () => {
  it('is in the history of no run, which shows only what the run recorded', async () => {
    const { server } = await serving();
    const echo = [
      '---',
      'language: typescript',
      '---',
      'export default function (input: Input): Output {',
      '  return input;',
      '}',
    ].join('\n');
    await server.call('POST', `${alpha}/definitions/computation`, {
      key: builder.key,
      body: { name: 'echo', source: echo },
    });

    const ran = await server.call('POST', `${alpha}/definitions/computation/echo/run`, {
      key: builder.key,
      body: { input: { said: 'hello' } },
    });
    await executeOf(server, 'search', { arguments: { query: 'acme' } });
    const history = await server.call('GET', `${alpha}/runs/${decodeRun(ran.body).run_id}/history`, {
      key: builder.key,
    });

    expect(decodeEvents(history.body).events.map(({ type }) => type)).toEqual(['run_started', 'run_succeeded']);
  });
});

describe('a call made by hand whose caller goes away over HTTP while the tool is called', () => {
  it('records a start and no answer, sends no second call, and still lets the session go', async () => {
    const { server, graph } = await serving();
    const leaving = new AbortController();

    const gone: Promise<unknown> = fetch(`${server.origin}${alpha}/tool-servers/graph/tools/sleep/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${builder.key}` },
      body: JSON.stringify({ arguments: { ms: 5000 } }),
      signal: leaving.signal,
    }).catch((error: unknown) => error);
    await until(
      () => graph.received().length,
      (received) => received === 1,
    );
    leaving.abort();

    expect(await gone).toMatchObject({ name: 'AbortError' });
    expect(
      await until(
        () => graph.endedSessions(),
        (ended) => ended === 1,
      ),
    ).toBe(1);
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    expect(events.body).toMatchObject({ events: [{ type: 'tool_call_started' }] });
    expect(graph.received()).toHaveLength(1);
  });
});
