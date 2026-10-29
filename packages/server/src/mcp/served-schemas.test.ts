import { mostListingBytes } from '@on.auto/api';
import {
  listedTools,
  mcpClientKinds,
  plainTextIn,
  technicalTextIn,
  withMcpSession,
  type ListedTool,
  type ToolResult,
} from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning(mcpClientKinds.map(() => answers(textResult('Profits rose.'))));
  await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
    await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' });
    await session.callTool('create_definition', {
      playbook: 'alpha',
      type: 'reasoning',
      name: 'summary',
      source: summary,
    });
  });
});

afterAll(async () => {
  await server.stop();
});

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    listedTools(await session.listTools()),
  );
}

interface ListingOnTheWire {
  readonly status: number;
  readonly bytes: number;
  readonly toolCount: number | undefined;
}

const listingMessageOf = Schema.decodeUnknownOption(
  Schema.Struct({ result: Schema.Struct({ tools: Schema.Array(Schema.Unknown) }) }),
);

function toolCountIn(body: string): number | undefined {
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  const message: unknown = data === undefined ? undefined : JSON.parse(data.slice('data: '.length));
  return Option.getOrUndefined(Option.map(listingMessageOf(message), ({ result }) => result.tools.length));
}

async function listingOnTheWire(path: string): Promise<ListingOnTheWire> {
  const answer = await fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await answer.text();
  return { status: answer.status, bytes: Buffer.byteLength(body), toolCount: toolCountIn(body) };
}

interface Endpoint {
  readonly path: string;
  readonly tools: number;
  readonly bytes: number;
  readonly mostBytes: number;
}

const endpoints: readonly Endpoint[] = [
  { path: '/mcp', tools: 31, bytes: 47_389, mostBytes: mostListingBytes['own org'] },
  { path: '/orgs/local/mcp', tools: 13, bytes: 15_537, mostBytes: mostListingBytes.org },
  { path: '/orgs/local/playbooks/alpha/mcp', tools: 20, bytes: 31_821, mostBytes: mostListingBytes.playbook },
];

describe('the tools of each endpoint', () => {
  it.each(endpoints)(
    'on $path each carry an input schema with an object root and no output schema',
    async ({ path, tools }) => {
      const listed = await listingOn(path);

      expect(listed.map(({ inputSchema }) => inputSchema['type'])).toEqual(
        Array.from({ length: tools }, () => 'object'),
      );
      expect(listed.filter(({ outputSchema }) => outputSchema !== undefined).map(({ name }) => name)).toEqual([]);
    },
  );
});

describe('the listing of each endpoint', () => {
  it.each(endpoints)(
    'on $path answers 200 with its $tools tools in $bytes bytes on the wire, within the $mostBytes the server starts with',
    async ({ path, tools, bytes, mostBytes }) => {
      const listing = await listingOnTheWire(path);

      expect(listing).toEqual({ status: 200, bytes, toolCount: tools });
      expect(bytes).toBeLessThanOrEqual(mostBytes);
    },
  );
});

function outputIn(result: ToolResult): unknown {
  const output: unknown = JSON.parse(technicalTextIn(result));
  return output;
}

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists the tools, then accepts the results of search, list_playbooks and run_definition without compiling an output validator', async () => {
    const outcome = await withMcpSession(kind, { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
      await session.listTools();
      const results = [
        await session.callTool('search', {}),
        await session.callTool('list_playbooks', {}),
        await session.callTool('run_definition', {
          playbook: 'alpha',
          type: 'reasoning',
          name: 'summary',
          input: { text: 'the quarter' },
        }),
      ];
      return { results, compiled: session.compiledOutputSchemas() };
    });

    expect(outcome.compiled).toEqual([]);
    expect(outcome.results.map((result) => plainTextIn(result))).toEqual([
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools guide says how.',
      'There is 1 playbook: “Alpha”.',
      'Ran the reasoning function “summary”. Its answer: “Profits rose.”',
    ]);
    expect(outcome.results.flatMap((result) => internalTermsIn(plainTextIn(result)))).toEqual([]);
    expect(outcome.results.map(({ structuredContent }) => structuredContent)).toMatchObject([
      { servers: [], tools: [], scopes: [] },
      { playbooks: [{ id: 'alpha' }] },
      { status: 'succeeded', output: 'Profits rose.' },
    ]);
    expect(outcome.results.map((result) => [result.content.length, outputIn(result)])).toEqual(
      outcome.results.map(({ structuredContent }) => [2, structuredContent]),
    );
  });
});

describe('search on the endpoint of a playbook, which lists no add_connection', () => {
  it('says that a person adds a server to the org as a connection, naming no tool the endpoint does not list', async () => {
    const url = `${server.origin}/orgs/local/playbooks/alpha/mcp`;

    const searched = await withMcpSession('current revision', { url, headers: {} }, (session) =>
      session.callTool('search', {}),
    );

    expect(plainTextIn(searched)).toBe(
      'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up, or a person adds one to the org as a connection; the give-tools guide says how.',
    );
  });
});
