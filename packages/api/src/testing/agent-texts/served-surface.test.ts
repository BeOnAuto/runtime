import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { debugPageServer, escaped, idsIn, type DebugPageServer } from '../debug-pages.ts';
import { acmeAdminActing } from '../operation-server.ts';
import { agentTextsOf, type AgentText } from './agent-texts.ts';
import { servedSurfaceAt, type ServedSurface } from './served-surface.ts';
import { readingAt } from './surfaces-served.ts';

let page: DebugPageServer;
let surface: ServedSurface;

beforeAll(async () => {
  page = await debugPageServer();
  surface = await servedSurfaceAt(readingAt(page.listening.origin));
});

afterAll(async () => {
  await page.close();
});

const renderedAsMarkdownOnThePage = /^prompt [^:]+: (message|attached .+)$/u;

function shownAsTheyAre({ received }: AgentText): boolean {
  return received.some(({ as }) => !renderedAsMarkdownOnThePage.test(as));
}

function namesOf(texts: readonly AgentText[], kind: string, on: string): readonly string[] {
  const named = texts
    .flatMap(({ received }) => received.filter((receipt) => receipt.on.includes(on)))
    .map(({ as }) => new RegExp(`^${kind} ([^:]+)(:|$)`, 'u').exec(as)?.[1])
    .filter((name) => name !== undefined);
  return [...new Set(named)].toSorted();
}

const connections = [
  ['/mcp', ''],
  ['/orgs/{org}/mcp', 'org-'],
  ['/orgs/{org}/playbooks/{playbook}/mcp', 'playbook-'],
  ['/directory', 'directory-'],
] as const;

describe('the texts listed from what a server serves, against its page at /debug', () => {
  it('hold every instruction, tool, argument, guide and prompt text that the page shows as it is', () => {
    const missing = agentTextsOf(surface, [])
      .filter((text) => shownAsTheyAre(text))
      .filter(({ lines }) => !page.page.text.includes(escaped(lines.join('\n'))));

    expect(missing).toEqual([]);
  });

  it.each(connections)('name on %s the tools and prompts that the page names', (on, prefix) => {
    const texts = agentTextsOf(surface, []);

    expect(namesOf(texts, 'tool', on)).toEqual(idsIn(page.page.text, prefix, 'tool'));
    expect(namesOf(texts, 'prompt', on)).toEqual(idsIn(page.page.text, prefix, 'prompt'));
  });

  it('name the guides that the page shows', () => {
    expect(namesOf(agentTextsOf(surface, []), 'guide', '/mcp')).toEqual(idsIn(page.page.text, '', 'guide'));
  });
});

describe('the instructions read from a server', () => {
  it('are as the page shows them, without the sentence that names the caller', () => {
    const [own] = surface.connections;

    expect(own?.instructions).not.toContain('This connection acts as');
    expect(page.page.text).toContain(`<pre class="verbatim">${escaped(String(own?.instructions))}</pre>`);
  });

  it('are refused where they are not the page’s with the caller’s sentence', async () => {
    const someoneElse = { ...acmeAdminActing, org: 'globex' };

    await expect(servedSurfaceAt({ ...readingAt(page.listening.origin), actingAs: someoneElse })).rejects.toThrow(
      "The instructions served on /mcp are not the ones /debug shows with the caller's sentence",
    );
  });
});
