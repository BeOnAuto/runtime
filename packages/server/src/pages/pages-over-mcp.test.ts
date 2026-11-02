import { listedTools, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingPages } from '../testing/servers/page-server.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';

const greeter = [
  '---',
  'description: Greets the person',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {greeting: {type: string}}, required: [greeting]}',
  '---',
  'Greet the person.',
].join('\n');

const greetingPage = [
  '---',
  'of: reasoning/greeter',
  '---',
  '{% result %}',
  '{{ output.greeting }}!',
  '{% endresult %}',
  '',
].join('\n');

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingPages([]);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

describe('a page over MCP', () => {
  it('is saved with create_definition and previewed with get_definition, its render over a sample output', async () => {
    const preview = await onAlpha(async (session) => {
      await session.callTool('create_definition', {
        type: 'reasoning',
        name: 'greeter',
        source: greeter,
        diagram: 'none',
      });
      await session.callTool('create_definition', { type: 'page', name: 'greetings', source: greetingPage });
      return session.callTool('get_definition', {
        type: 'page',
        name: 'greetings',
        render: true,
        sample_output: { greeting: 'Good morning' },
      });
    });

    expect(preview.structuredContent).toMatchObject({
      type: 'page',
      details: { of: 'reasoning/greeter' },
      page: { result: 'Good morning!' },
    });
  });

  it('is a type the definition tools take and the run tools do not', async () => {
    const tools = await onAlpha(async (session) => listedTools(await session.listTools()));
    const typesOf = (name: string): string =>
      JSON.stringify(tools.find((tool) => tool.name === name)?.inputSchema['properties']);

    expect(typesOf('create_definition')).toContain('"page"');
    expect(typesOf('run_definition')).not.toContain('"page"');
    expect(typesOf('list_runs')).not.toContain('"page"');
  });
});
