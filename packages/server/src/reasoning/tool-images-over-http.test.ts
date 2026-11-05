import { Buffer } from 'node:buffer';

import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
    ),
  }),
);

const decodeKeptAnswer = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      result: Schema.Struct({
        content: Schema.Tuple([Schema.Struct({ type: Schema.Literal('image'), asset: Schema.String }), Schema.Unknown]),
      }),
    }),
  }),
);

const decodeAsset = Schema.decodeUnknownSync(
  Schema.Struct({ media_type: Schema.String, model: Schema.NullOr(Schema.String), address: Schema.String }),
);

async function servingThePhoto(recordContent: boolean): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const photographed = callingTools([['graph__photo', {}]], answers(textResult('A pixel.')));
  const server = await servingReasoning([photographed], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        org: 'acme',
        record_content: recordContent,
      },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/photo]', '---', 'Look.'].join('\n');
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'look', source, diagram: 'none' } });
  await server.call('POST', `${alpha}/definitions/reasoning/look/run`, { body: { input: {}, run_id: runId } });
  return server;
}

async function eventsOfType(server: ReasoningServer, type: string) {
  return decodeEvents((await server.call('GET', `${alpha}/events?type=${type}`)).body).events;
}

describe('an image a tool answered a run, over HTTP', () => {
  it('is kept as an asset of the run, which the answer the run recorded names and get_asset reads at an address of its bytes', async () => {
    const server = await servingThePhoto(true);
    const history = decodeEvents((await server.call('GET', `${alpha}/runs/${runId}/history`)).body).events;
    const answered = history.find(({ type }) => type === 'tool_call_answered');

    const kept = decodeKeptAnswer((await server.call('GET', `${alpha}/events/${String(answered?.id)}`)).body);
    const [image] = kept.data.result.content;
    const asset = decodeAsset((await server.call('GET', `${alpha}/assets/${image.asset}`)).body);
    const bytes = await fetch(asset.address).then(async (answer) => Buffer.from(await answer.arrayBuffer()));

    expect(asset).toMatchObject({ media_type: 'image/png', model: null });
    expect(bytes.toString('base64')).toBe(pixel);
    expect(await eventsOfType(server, 'asset_kept')).toMatchObject([
      { data: { kind: 'image', made_by: { tool_call: { server: 'graph', tool: 'photo' } } } },
    ]);
  });

  it('is not kept where the server keeps no content', async () => {
    const server = await servingThePhoto(false);

    expect(await eventsOfType(server, 'asset_kept')).toEqual([]);
  });
});
