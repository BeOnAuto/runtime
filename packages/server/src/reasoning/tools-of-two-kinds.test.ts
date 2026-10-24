import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeApi, serveFakeMcp } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ type: Schema.String, data: Schema.Struct({ server: Schema.optionalKey(Schema.String) }) }),
    ),
  }),
);

const searchedBoth = callingTools(
  [
    ['graph__search', { query: 'acme' }],
    ['billing__search', { query: 'acme' }],
  ],
  answers(textResult('Acme has 2 rows in the graph and 2 in billing.')),
);

async function servingBoth() {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const billing = await serveFakeApi({ key: apiKey });
  onTestFinished(billing.close);
  const server = await servingReasoning([searchedBoth], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      billing: { document: billing.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  onTestFinished(server.stop);
  const source = [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'tools: [graph/search, billing/search]',
    '---',
    'Count acme.',
  ];
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'count', source: source.join('\n') } });
  return { graph, billing, server };
}

describe('a reasoning function that names a tool of an MCP server and a tool of an HTTP API', () => {
  it('calls both in one run, each the same way, and its history records both calls', async () => {
    const { graph, billing, server } = await servingBoth();

    const run = await server.call('POST', `${alpha}/definitions/reasoning/count/run`, {
      body: { input: {}, run_id: runId },
    });
    const history = decodeHistory((await server.call('GET', `${alpha}/runs/${runId}/history`)).body);

    expect(run).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: 'Acme has 2 rows in the graph and 2 in billing.' },
    });
    const types = history.events.map(({ type }) => type);
    const calls = history.events.slice(3, -3);
    expect([...types.slice(0, 3), ...types.slice(-3)]).toEqual([
      'run_started',
      'model_call_started',
      'model_call_answered',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(calls.map(({ type }) => type).toSorted()).toEqual([
      'tool_call_answered',
      'tool_call_answered',
      'tool_call_started',
      'tool_call_started',
    ]);
    expect(calls.map(({ data }) => data.server)).toEqual(expect.arrayContaining(['billing', 'graph', undefined]));
    expect(graph.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'auto.on/run_id': runId } },
    ]);
    expect(billing.seen()).toMatchObject([{ method: 'GET', path: '/v1/search', query: '?query=acme' }]);
  });
});
