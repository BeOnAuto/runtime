import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const marks = { reads: ['echo', 'archive_note'], acts: ['search'] };

describe('the marks an entry of the settings gives the tools of its server, over HTTP', () => {
  it('mark the tools they name in place of their server, and warn in the log of a name the server does not list', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const graph = await serveFakeMcp({ bearer: apiKey });
    closing.push(graph.close);
    const headers = { Authorization: 'Bearer ${GRAPH_API_KEY}' };
    const server = await servingReasoning([], {
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers, org: 'acme', allowed: ['search', 'echo'], marks },
      }),
    });
    closing.push(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const searched = await server.call('GET', `${alpha}/tool-servers/search`);
    const warned = logged.mock.calls
      .flat()
      .map(String)
      .filter((line) => line.includes('archive_note'));

    expect(searched.body).toMatchObject({
      tools: [
        { tool: 'search', mark: 'acts' },
        { tool: 'echo', mark: 'reads' },
      ],
    });
    expect(warned).toEqual([
      expect.stringContaining(
        '"message":"The tool server graph lists no tool archive_note, which its entry marks","level":"WARN"',
      ),
    ]);
  });
});
