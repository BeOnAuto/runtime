import { callDocument } from '@on.auto/interaction/testing';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const photographedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const sentRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const guessedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const AssetSchema = Schema.Struct({
  id: Schema.String,
  media_type: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String,
  address: Schema.NullOr(Schema.String),
  address_until: Schema.NullOr(Schema.String),
});

const decodeAsset = Schema.decodeUnknownSync(AssetSchema);

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
      result: Schema.Struct({ content: Schema.Tuple([Schema.Struct({ asset: Schema.String }), Schema.Unknown]) }),
    }),
  }),
);

const decodeArguments = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ arguments: Schema.Record(Schema.String, Schema.Json) }) }),
);

function answering(name: string, properties: FakeTool['inputSchema']['properties']): FakeTool {
  return {
    name,
    inputSchema: { type: 'object', properties, required: [] },
    answer: () => ({ content: [{ type: 'text', text: '"done"' }] }),
  };
}

const tools: readonly FakeTool[] = [
  answering('upload', { name: { type: 'string' }, file: { type: 'string', contentEncoding: 'base64' } }),
  answering('save', { name: { type: 'string' }, content: { type: 'string' } }),
];

interface Photographed {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
  readonly photo: typeof AssetSchema.Type;
}

async function eventsOf(server: ReasoningServer, path: string) {
  return decodeEvents((await server.call('GET', `${alpha}/${path}`)).body).events;
}

async function photographed(): Promise<Photographed> {
  const graph = await serveFakeMcp({ bearer: apiKey, tools });
  onTestFinished(graph.close);
  const looking = callingTools([['graph__photo', {}]], answers(textResult('A pixel.')));
  const server = await servingReasoning([looking], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/photo]', '---', 'Look.'].join('\n');
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'look', source, diagram: 'none' } });
  await server.call('POST', `${alpha}/definitions/reasoning/look/run`, {
    body: { input: {}, run_id: photographedRunId },
  });
  const [answered] = await eventsOf(server, 'events?type=tool_call_answered');
  const kept = decodeKeptAnswer((await server.call('GET', `${alpha}/events/${String(answered?.id)}`)).body);
  const [image] = kept.data.result.content;
  const answer = decodeAsset((await server.call('GET', `${alpha}/assets/${image.asset}`)).body);
  const { id, media_type: mediaType, bytes, sha256, address, address_until: until } = answer;
  return { server, graph, photo: { id, media_type: mediaType, bytes, sha256, address, address_until: until } };
}

function sending(tool: string, argument: string): string {
  return callDocument({
    server: 'graph',
    tool,
    read: null,
    with: ["    name: 'photo.png'", `    ${argument}: '{{ input.photo }}'`],
    input: ['input:', '  schema: { type: object }'],
    output: ['output:', '  schema: {}'],
  });
}

async function sentBy({ server }: Photographed, tool: string, argument: string, input: unknown) {
  await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: `${tool}-${argument}`, source: sending(tool, argument), diagram: 'none' },
  });
  return server.call('POST', `${alpha}/definitions/interaction/${tool}-${argument}/run`, {
    body: { input, run_id: argument === 'file' ? sentRunId : guessedRunId },
  });
}

function sentTo(graph: FakeMcpServer) {
  return graph.received().filter(({ tool }) => tool !== 'photo');
}

describe('an asset an interaction function passes whole to a tool, over HTTP', () => {
  it('reaches the tool as the base64 its schema asks for, and the call records the asset, not its bytes', async () => {
    const photographing = await photographed();
    const { server, graph, photo } = photographing;

    const ran = await sentBy(photographing, 'upload', 'file', { photo });
    const started = (await eventsOf(server, `runs/${sentRunId}/history`)).find(
      ({ type }) => type === 'tool_call_started',
    );
    const recorded = decodeArguments((await server.call('GET', `${alpha}/events/${String(started?.id)}`)).body);

    expect(ran.body).toMatchObject({ status: 'succeeded', output: 'done' });
    expect(sentTo(graph)).toMatchObject([{ tool: 'upload', arguments: { name: 'photo.png', file: pixel } }]);
    expect(recorded.data.arguments).toEqual({ name: 'photo.png', file: photo });
  });

  it('is refused, sending nothing, where the tool takes text, and where it names no asset of the playbook', async () => {
    const photographing = await photographed();
    const { graph, photo } = photographing;

    const asText = await sentBy(photographing, 'save', 'content', { photo });
    const guessed = await sentBy(photographing, 'upload', 'file', { photo: { ...photo, sha256: 'b'.repeat(64) } });

    expect(asText.body).toMatchObject({
      status: 409,
      reason: 'conflict',
      kind: 'unworkable',
      detail: `The argument /content is a file of image/png, and the save tool of graph takes text there; a tool takes a file where its schema says format: byte or contentEncoding: base64; send it to a tool that takes one`,
    });
    expect(guessed.body).toMatchObject({ reason: 'invalid_input' });
    expect(sentTo(graph)).toEqual([]);
  });
});

describe('an asset a person’s agent names in a call made by hand, over HTTP', () => {
  it('reaches the tool as a run’s call would, checked in the caller’s playbook', async () => {
    const { server, graph, photo } = await photographed();

    const executed = await server.call('POST', `${alpha}/tool-servers/graph/tools/upload/execute`, {
      body: { arguments: { name: 'photo.png', file: photo } },
    });

    expect(executed.body).toMatchObject({ outcome: 'result', answer: 'done' });
    expect(sentTo(graph)).toMatchObject([{ tool: 'upload', arguments: { file: pixel } }]);
  });
});
