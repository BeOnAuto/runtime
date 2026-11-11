import { agentTextsOf, escaped, idsIn, type AgentText } from '@on.auto/api/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { servedByAThrowawayServer, type ServedToAnAgent } from './served-to-an-agent.ts';

let served: ServedToAnAgent;

beforeAll(async () => {
  served = await servedByAThrowawayServer();
});

const renderedAsMarkdownOrNotOnThePage = /^(prompt [^:]+: (message|attached .+)|first answer of .+)$/u;

function shownOnThePage({ received }: AgentText): boolean {
  return received.some(({ as }) => !renderedAsMarkdownOrNotOnThePage.test(as));
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

describe('what a throwaway server of this release serves an agent', () => {
  it('holds, text for text, what its own page at /debug shows', () => {
    const missing = agentTextsOf(served.surface, [])
      .filter((text) => shownOnThePage(text))
      .filter(({ lines }) => !served.page.includes(escaped(lines.join('\n'))))
      .map(({ received }) => received[0]?.as);

    expect(missing).toEqual([]);
  });

  it.each(connections)('names on %s the tools and prompts its page names', (on, prefix) => {
    const texts = agentTextsOf(served.surface, []);

    expect(namesOf(texts, 'tool', on)).toEqual(idsIn(served.page, prefix, 'tool'));
    expect(namesOf(texts, 'prompt', on)).toEqual(idsIn(served.page, prefix, 'prompt'));
  });

  it('names the guides of each shelf its page shows', () => {
    const texts = agentTextsOf(served.surface, []);

    expect(namesOf(texts, 'guide', '/mcp')).toEqual(idsIn(served.page, '', 'guide'));
    expect(namesOf(texts, 'guide', '/directory')).toEqual(idsIn(served.page, 'directory-', 'guide'));
  });

  it('answers the first call on a new org with words that give the server its own address as {origin}', () => {
    const [welcome] = served.surface.answers;

    expect(welcome).toMatchObject({ tool: 'list_playbooks', arguments: {}, path: '/mcp' });
    expect(welcome?.text).toContain('{origin}/studio/');
    expect(welcome?.text).not.toContain('127.0.0.1');
  });

  it('gives no connection’s instructions the sentence that names the caller', () => {
    expect(
      served.surface.connections.filter(({ instructions }) => instructions.includes('This connection acts as')),
    ).toEqual([]);
  });
});
