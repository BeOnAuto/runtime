import { mostListingBytes } from '@on.auto/api';
import {
  type ListedTool,
  listedTools,
  mcpClientKinds,
  plainTextIn,
  technicalTextIn,
  type ToolResult,
  withMcpSession,
} from '@on.auto/api/testing';
import { defaultOrg } from '@on.auto/openid-connect';
import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

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

interface Reached {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
}

function listingOnTheWire(path: string): Promise<ListingOnTheWire> {
  return listingOnTheWireAt({ origin: server.origin, headers: {} }, path);
}

async function listingOnTheWireAt({ origin, headers }: Reached, path: string): Promise<ListingOnTheWire> {
  const answer = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      ...headers,
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
  { path: '/mcp', tools: 43, bytes: 69_828, mostBytes: mostListingBytes['own org'] },
  { path: '/directory', tools: 41, bytes: 67_391, mostBytes: mostListingBytes.directory },
  { path: '/orgs/local/mcp', tools: 18, bytes: 25_303, mostBytes: mostListingBytes.org },
  { path: '/orgs/local/playbooks/alpha/mcp', tools: 30, bytes: 47_716, mostBytes: mostListingBytes.playbook },
];

function outputIn(result: ToolResult): unknown {
  const output: unknown = JSON.parse(technicalTextIn(result));
  return output;
}

async function listingOnTheWireServedSchemasWith(
  path: string,
): Promise<{ status: number; bytes: number; tools: number | undefined }> {
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
  return { status: answer.status, bytes: Buffer.byteLength(body), tools: toolCountIn(body) };
}

const endpointsServedSchemasWith = [
  { path: '/mcp', tools: 45, bytes: 76_209, mostBytes: mostListingBytes['own org'] },
  { path: '/directory', tools: 43, bytes: 73_772, mostBytes: mostListingBytes.directory },
  { path: '/orgs/local/mcp', tools: 18, bytes: 27_772, mostBytes: mostListingBytes.org },
  { path: '/orgs/local/playbooks/alpha/mcp', tools: 32, bytes: 51_542, mostBytes: mostListingBytes.playbook },
] as const;

const endpointsOfTheShippedServerSigningPeopleIn: readonly Endpoint[] = [
  { path: '/mcp', tools: 47, bytes: 77_437, mostBytes: mostListingBytes['own org'] },
  { path: '/directory', tools: 45, bytes: 75_000, mostBytes: mostListingBytes.directory },
  { path: `/orgs/${defaultOrg}/mcp`, tools: 20, bytes: 29_000, mostBytes: mostListingBytes.org },
  { path: `/orgs/${defaultOrg}/playbooks/alpha/mcp`, tools: 32, bytes: 51_542, mostBytes: mostListingBytes.playbook },
];

describe('served schemas', () => {
  beforeAll(async () => {
    server = await servingReasoning(mcpClientKinds.map(() => answers(textResult('Profits rose.'))));
    await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
      await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' });
      await session.callTool('create_definition', {
        playbook: 'alpha',
        type: 'reasoning',
        name: 'summary',
        source: summary,
        diagram: 'none',
      });
    });
  });

  afterAll(async () => {
    await server.stop();
  });

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
        'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools recipe of get_guide says how.',
        'There is 1 playbook: “Alpha”.',
        'Ran the reasoning function “summary”. Its answer: “Profits rose.”',
      ]);
      expect(outcome.results.flatMap((result) => internalTermsIn(plainTextIn(result)))).toEqual([]);
      expect(outcome.results.map(({ structuredContent }) => structuredContent)).toMatchObject([
        { servers: [], tools: [], scopes: [] },
        { playbooks: [{ id: 'alpha' }] },
        { status: 'succeeded', output: 'Profits rose.' },
      ]);
      expect(outcome.results.map((result) => [result.content.length, plainTextIn(result), outputIn(result)])).toEqual(
        outcome.results.map(({ structuredContent }) => {
          const { in_words: words, ...output } = { ...structuredContent };
          return [2, words, output];
        }),
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
        'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up, or a person adds one to the org as a connection; the give-tools recipe of get_guide says how.',
      );
    });
  });
});

describe('served schemas with goals', () => {
  beforeAll(async () => {
    server = await servingReasoningWithGoals(mcpClientKinds.map(() => []));
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('the listing of each endpoint of a server that keeps goals', () => {
    it.each(endpointsServedSchemasWith)(
      'on $path answers 200 with its $tools tools in $bytes bytes on the wire, within the $mostBytes the server starts with',
      async ({ path, tools, bytes, mostBytes }) => {
        const listing = await listingOnTheWireServedSchemasWith(path);

        expect(listing).toEqual({ status: 200, bytes, tools });
        expect(bytes).toBeLessThanOrEqual(mostBytes);
      },
    );
  });
});

describe('served schemas of the server as it ships, signing people in', () => {
  it('lists each endpoint to its admin, list_members and invite_member among the tools, in its pinned tools and bytes on the wire, within the bound the server starts with', async () => {
    const signing = await personSigningIn();
    const ledger = temporaryLedger();
    const shipped = await startServer(
      { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...signing.environment },
      testComposition(),
    );
    onTestFinished(async () => {
      await shipped.stop();
      ledger.remove();
    });
    const origin = `http://127.0.0.1:${shipped.port}`;
    const reached = { origin, headers: { authorization: `Bearer ${await signing.agentTokenAt(origin, 'Ada')}` } };

    const listings = await Promise.all(
      endpointsOfTheShippedServerSigningPeopleIn.map(({ path }) => listingOnTheWireAt(reached, path)),
    );

    expect(listings).toEqual(
      endpointsOfTheShippedServerSigningPeopleIn.map(({ tools, bytes }) => ({ status: 200, bytes, toolCount: tools })),
    );
    expect(endpointsOfTheShippedServerSigningPeopleIn.filter(({ bytes, mostBytes }) => bytes > mostBytes)).toEqual([]);
  });
});
