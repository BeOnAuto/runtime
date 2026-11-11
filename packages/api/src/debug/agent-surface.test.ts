import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { debugPageServer, escaped, idsIn, type DebugPageServer } from '../testing/debug-pages.ts';
import { textOf, withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { toolNamesIn } from '../testing/tool-listing.ts';

let served: DebugPageServer;

beforeAll(async () => {
  served = await debugPageServer();
});

afterAll(async () => {
  await served.close();
});

const PromptsSchema = Schema.Struct({ prompts: Schema.Array(Schema.Struct({ name: Schema.String })) });

interface Served {
  readonly instructions: string;
  readonly tools: readonly string[];
  readonly prompts: readonly string[];
}

function servedAt(path: string): Promise<Served> {
  const connecting = {
    url: `${served.listening.origin}${path}`,
    headers: { authorization: `Bearer ${acmeAdmin.key}` },
  };
  return withMcpSession('current revision', connecting, async (session) => ({
    instructions: String(session.instructions).replace(/ This connection acts as [^.]+\./u, ''),
    tools: toolNamesIn(await session.listTools()).toSorted(),
    prompts: Schema.decodeUnknownSync(PromptsSchema)(await session.listPrompts())
      .prompts.map(({ name }) => name)
      .toSorted(),
  }));
}

const connections = [
  ['/mcp', ''],
  ['/orgs/acme/mcp', 'org-'],
  ['/orgs/acme/playbooks/alpha/mcp', 'playbook-'],
  ['/directory', 'directory-'],
] as const;

describe('what the page at /debug shows of each connection', () => {
  it.each(connections)('is the instructions, the tools and the prompts %s serves', async (path, prefix) => {
    const { instructions, tools, prompts } = await servedAt(path);
    expect(served.page.text).toContain(`<pre class="verbatim">${escaped(instructions)}</pre>`);
    expect(idsIn(served.page.text, prefix, 'tool')).toEqual(tools);
    expect(idsIn(served.page.text, prefix, 'prompt')).toEqual(prompts);
  });

  it('lists tools that answer as the page describes them', async () => {
    const connecting = { url: `${served.listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
    const answer = await withMcpSession('current revision', connecting, async (session) =>
      textOf(await session.callTool('create_playbook', { name: 'Ledger' })),
    );
    expect(answer).toContain('make');
  });

  it('shows what a client receives when a prompt is picked, its words in braces', () => {
    const { text } = served.page;
    expect(text).toContain('Take a note that says {text}.');
    expect(text).toContain('Attached resource: <code>guide://notebook</code>');
    expect(text).toContain('Create a playbook in Auto with one function');
    expect(text).toContain('<p>This connection offers no prompts.</p>');
  });
});
