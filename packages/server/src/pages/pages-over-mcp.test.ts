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
  'page:',
  "  result: '{{ output.greeting }}!'",
  '---',
  'Greet the person.',
].join('\n');

const playbookPage = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    runs: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return { runs: { values: [...(view.runs?.values ?? []), { name: event.type, value: 1 }] } };',
  '    }',
  "runs: '{{ views.runs.values | size }} runs.'",
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
  it('is saved in the document of its definition, and previewed with get_definition over a sample output', async () => {
    const preview = await onAlpha(async (session) => {
      await session.callTool('create_definition', {
        type: 'reasoning',
        name: 'greeter',
        source: greeter,
        diagram: 'none',
      });
      return session.callTool('get_definition', {
        type: 'reasoning',
        name: 'greeter',
        render: true,
        sample_output: { greeting: 'Good morning' },
      });
    });

    expect(preview.structuredContent).toMatchObject({
      type: 'reasoning',
      name: 'greeter',
      source: greeter,
      page: { result: 'Good morning!' },
    });
  });

  it('is no type of definition', async () => {
    const tools = await onAlpha(async (session) => listedTools(await session.listTools()));
    const typesOf = (name: string): string =>
      JSON.stringify(tools.find((tool) => tool.name === name)?.inputSchema['properties']);

    expect(typesOf('create_definition')).not.toContain('"page"');
    expect(typesOf('list_runs')).not.toContain('"page"');
  });
});

describe("the playbook's page over MCP", () => {
  it('is saved with update_playbook and read with get_playbook, on the endpoint of the org', async () => {
    server = await servingPages([]);
    const read = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/mcp`, headers: {} },
      async (session) => {
        await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' });
        await session.callTool('update_playbook', { playbook: 'alpha', page: playbookPage });
        return session.callTool('get_playbook', { playbook: 'alpha' });
      },
    );

    expect(read.structuredContent).toMatchObject({ id: 'alpha', page: { source: playbookPage } });
  });
});
