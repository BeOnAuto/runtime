import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let page: string;

beforeAll(async () => {
  server = await servingReasoning([]);
  page = await (await fetch(`${server.origin}/debug`)).text();
});

afterAll(async () => {
  await server.stop();
});

function idsIn(prefix: string, kind: string): readonly string[] {
  return [...page.matchAll(new RegExp(`id="${prefix}${kind}-([a-z_-]+)"`, 'gu'))].map(
    ([, name = '']: readonly string[]) => name,
  );
}

function toolsAt(path: string): Promise<readonly string[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    toolNamesIn(await session.listTools()),
  );
}

function sectionOf(id: string): string {
  const start = page.indexOf(`id="${id}"`);
  return page.slice(start, page.indexOf('<section', start));
}

describe('the page at /debug of the server', () => {
  it('lists the tools /mcp and /directory list', async () => {
    expect(idsIn('', 'tool').toSorted()).toEqual((await toolsAt('/mcp')).toSorted());
    expect(idsIn('directory-', 'tool').toSorted()).toEqual((await toolsAt('/directory')).toSorted());
  });

  it('shows the start guide first, and the directory listing without the generation function', () => {
    expect([idsIn('', 'guide')[0], idsIn('directory-', 'guide')[0]]).toEqual(['start', 'start']);
    expect(idsIn('', 'guide')).toContain('generation-function');
    expect(idsIn('directory-', 'guide')).not.toContain('generation-function');
    expect(page).not.toContain('#directory-guide-generation-function');
  });

  it('renders the tables and the code of a guide', () => {
    const guide = sectionOf('guide-reasoning-function');
    expect(guide).toContain('<table>');
    expect(guide).toMatch(/<pre><code class="language-[a-z]+">/u);
  });
});
