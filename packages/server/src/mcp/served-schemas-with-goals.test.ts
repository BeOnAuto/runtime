import { mostListingBytes } from '@on.auto/api';
import { mcpClientKinds } from '@on.auto/api/testing';
import { Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoningWithGoals(mcpClientKinds.map(() => []));
});

afterAll(async () => {
  await server.stop();
});

const listingMessageOf = Schema.decodeUnknownOption(
  Schema.Struct({ result: Schema.Struct({ tools: Schema.Array(Schema.Unknown) }) }),
);

function toolCountIn(body: string): number | undefined {
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  const message: unknown = data === undefined ? undefined : JSON.parse(data.slice('data: '.length));
  return Option.getOrUndefined(Option.map(listingMessageOf(message), ({ result }) => result.tools.length));
}

async function listingOnTheWire(path: string): Promise<{ status: number; bytes: number; tools: number | undefined }> {
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

const endpoints = [
  { path: '/mcp', tools: 42, bytes: 67_157, mostBytes: mostListingBytes['own org'] },
  { path: '/directory', tools: 40, bytes: 64_728, mostBytes: mostListingBytes.directory },
  { path: '/orgs/local/mcp', tools: 18, bytes: 26_109, mostBytes: mostListingBytes.org },
  { path: '/orgs/local/playbooks/alpha/mcp', tools: 28, bytes: 43_636, mostBytes: mostListingBytes.playbook },
] as const;

describe('the listing of each endpoint of a server that keeps goals', () => {
  it.each(endpoints)(
    'on $path answers 200 with its $tools tools in $bytes bytes on the wire, within the $mostBytes the server starts with',
    async ({ path, tools, bytes, mostBytes }) => {
      const listing = await listingOnTheWire(path);

      expect(listing).toEqual({ status: 200, bytes, tools });
      expect(bytes).toBeLessThanOrEqual(mostBytes);
    },
  );
});
