import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let tools: readonly ListedTool[];

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

beforeAll(async () => {
  server = await servingReasoning([]);
  tools = await onMcp(async (session) => listedTools(await session.listTools()));
});

afterAll(async () => {
  await server.stop();
});

function titledAgainAsItsAnnotation({ title, annotations }: ListedTool): boolean {
  return title !== undefined && annotations?.['title'] === title;
}

describe('the titles of the tools of /mcp', () => {
  it('are given again as the title annotation, which the directory listing shows as the name of each tool', () => {
    expect(tools.filter((tool) => !titledAgainAsItsAnnotation(tool)).map(({ name }) => name)).toEqual([]);
  });
});
