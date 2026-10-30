import { createHash } from 'node:crypto';

import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const pin = '73914286';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const sent = { said: `the key is ${apiKey}`, [apiKey]: 'a key', pin: Number(pin) };

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
    ),
  }),
);

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function servingTheEcho(recordContent: boolean): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const echoed = callingTools([['graph__echo', sent]], answers(textResult('Echoed.')));
  const server = await servingReasoning([echoed], {
    GRAPH_API_KEY: apiKey,
    GRAPH_PIN: pin,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Pin': '${GRAPH_PIN}' },
        org: 'acme',
        record_content: recordContent,
      },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/echo]', '---', 'Echo it.'].join('\n');
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'echo', source } });
  await server.call('POST', `${alpha}/definitions/reasoning/echo/run`, { body: { input: {}, run_id: runId } });
  return server;
}

async function callEventsOf(server: ReasoningServer) {
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const calls = decodeEvents(history.body).events.filter(({ type }) => type.startsWith('tool_call_'));
  const wholes = await Promise.all(
    calls.map(async ({ id }) => (await server.call('GET', `${alpha}/events/${id}`)).body),
  );
  return { page: history.body, calls, wholes: decodeEvents({ events: wholes }).events };
}

describe('the digests of what a call sent and received, over HTTP', () => {
  it('name the scrubbed text the playbook kept, and the key and the pin appear on no page, no event read whole and no line of the log', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const server = await servingTheEcho(true);

    const { page, calls, wholes } = await callEventsOf(server);
    const seen = JSON.stringify([page, wholes, ...logged.mock.calls.flat().map(String)]);
    const keptTexts = [JSON.stringify(wholes[0]?.data['arguments']), JSON.stringify(wholes[1]?.data['result'])];

    expect(calls.map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
    expect(calls.map(({ data }) => [data['arguments_sha256'], data['result_sha256']])).toEqual([
      [digestOf(String(keptTexts[0])), undefined],
      [undefined, digestOf(String(keptTexts[1]))],
    ]);
    expect(keptTexts.map((text) => text.includes('[redacted]'))).toEqual([true, true]);
    expect(seen).not.toContain(apiKey);
    expect(seen).not.toContain(pin);
  });

  it('are left out of the facts of a server that keeps no content, which carry their sizes, and an event read whole joins nothing', async () => {
    const server = await servingTheEcho(false);

    const { calls, wholes } = await callEventsOf(server);

    expect(calls.map(({ data }) => Object.keys(data).filter((field) => /_(?:bytes|sha256)$/u.test(field)))).toEqual([
      ['arguments_bytes'],
      ['result_bytes'],
    ]);
    expect(wholes.map(({ data }) => ['arguments', 'result', 'answer'].filter((field) => field in data))).toEqual([
      [],
      [],
    ]);
  });
});
