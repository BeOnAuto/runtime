import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;

function on<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

interface Served {
  readonly instructions: string | undefined;
  readonly tools: unknown;
  readonly prompts: unknown;
  readonly resources: unknown;
  readonly searched: unknown;
}

function servedAt(path: string): Promise<Served> {
  return on(path, async (session) => ({
    instructions: session.instructions,
    tools: await session.listTools(),
    prompts: await session.listPrompts(),
    resources: await session.listResources(),
    searched: await session.callTool('search', { terms: 'stripe payments refunds' }),
  }));
}

function namesAt(path: string): Promise<readonly string[]> {
  return on(path, async (session) => JSON.stringify(await session.listTools()).match(/"name":"[a-z_]+"/gu) ?? []);
}

const readingAnAsset = '"name":"get_asset"';

let everything: string;

let directory: string;

beforeAll(async () => {
  server = await servingReasoning([]);
  everything = JSON.stringify(await servedAt('/mcp'));
  directory = JSON.stringify(await servedAt('/directory'));
});

afterAll(async () => {
  await server.stop();
});

const generationWords = /\bgeneration\b|generation-function|asset_kept|asset_expired|asset_content_removed/u;

describe('the directory listing at /directory', () => {
  it('names no generation function, its guide or its facts, which /mcp names', () => {
    expect([generationWords.test(everything), generationWords.test(directory)]).toEqual([true, false]);
  });

  it('offers no provider whose tools handle money, which /mcp offers', () => {
    expect([/"name":"stripe"/u.test(everything), /"name":"stripe"/u.test(directory)]).toEqual([true, false]);
  });

  it('lists the tools /mcp lists but get_asset, which reads what a generation function made', async () => {
    const everyName = await namesAt('/mcp');

    expect(everyName).toContain(readingAnAsset);
    expect(await namesAt('/directory')).toEqual(everyName.filter((name) => name !== readingAnAsset));
  });
});
