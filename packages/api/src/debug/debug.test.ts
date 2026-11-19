import { createHash } from 'node:crypto';

import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  debugPageServer,
  type DebugPageServer,
  debugServing,
  debugStyleOnDisk,
  escaped,
  idsIn,
} from '../testing/debug-pages.ts';
import { textOf, withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { toolNamesIn } from '../testing/tool-listing.ts';
import { debugPageAnswerOf } from './debug-routes.ts';
import { argumentsIn, type ShownTool, toolGroupsOf } from './shown-tools.ts';

let served: DebugPageServer;

beforeAll(async () => {
  served = await debugPageServer();
});

afterAll(async () => {
  await served.close();
});

describe('a tool on the page at /debug', () => {
  it('shows each argument with its type and whether it is required, a nested one by its path', () => {
    const { text } = served.page;
    expect(text).toContain('<td>name<span class="required">required</span></td>');
    expect(text).toContain('<td><code>string | null</code></td>');
    expect(text).toContain('<td>size.pages<span class="required">required</span></td>');
    expect(text).toContain('<p class="subtitle">Takes no arguments.</p>');
  });

  it('shows the arguments of each item of a list by the path of the list', () => {
    const listed = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { kind: { type: 'string', description: 'Its kind' } },
            required: ['kind'],
          },
        },
      },
    };

    expect(argumentsIn(listed).map(({ name, required, description }) => [name, required, description])).toEqual([
      ['items', false, ''],
      ['items[].kind', true, 'Its kind'],
    ]);
  });

  it('shows the values an argument takes, its pattern or its longest length', () => {
    const { text } = served.page;
    expect(text).toContain('One of <code>plain</code>, <code>fancy</code>');
    expect(text).toContain('<p class="limit">Pattern <code>');
    expect(text).toContain('<p class="limit">At most 100 characters</p>');
  });

  it('shows what its annotations hint', () => {
    const { text } = served.page;
    expect(text).toMatch(/<ul class="hints">\s*<li>reads only<\/li><li>safe to repeat<\/li>\s*<\/ul>/u);
    expect(text).toContain('<li>reads only</li><li>safe to repeat</li><li>reaches outside</li>');
    expect(text).toMatch(/<ul class="hints">\s*<li>may destroy<\/li>\s*<\/ul>/u);
  });
});

function hashOf(element: string): string {
  const inside = new RegExp(`<${element}>([\\s\\S]*?)</${element}>`, 'u').exec(served.page.text)?.[1] ?? '';
  return `'sha256-${createHash('sha256').update(inside).digest('base64')}'`;
}

describe('the page at /debug', () => {
  it('answers a caller with no key with one HTML document', () => {
    const { status, headers, text } = served.page;
    expect([status, headers.get('content-type')]).toEqual([200, 'text/html; charset=UTF-8']);
    expect(text.startsWith('<!doctype html>')).toBe(true);
  });

  it('allows only its own script and style, by their hashes', () => {
    const policy = String(served.page.headers.get('content-security-policy'));
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src ${hashOf('script')}`);
    expect(policy).toContain(`style-src ${hashOf('style')}`);
    expect(served.page.headers.get('cache-control')).toBe('no-store');
  });

  it('renders each guide of a shelf once, in its order, beside its raw Markdown', () => {
    const { text } = served.page;
    expect(idsIn(text, '', 'guide')).toEqual(['notebook', 'take-a-note', 'terminology']);
    expect(text.indexOf('id="guide-terminology"')).toBeLessThan(text.indexOf('id="guide-notebook"'));
    expect(text).toContain('<h1>Notebook</h1>');
    expect(text).toContain('<pre class="verbatim"># Notebook\n\nA note has a name');
    expect(text).toContain('href="#org-guide-notebook"');
  });

  it('gives the directory listing its own shelf, without the guides it lacks', () => {
    expect(idsIn(served.page.text, 'directory-', 'guide')).toEqual(['notebook', 'take-a-note']);
    expect(served.page.text).toContain('href="#directory-guide-notebook"');
    expect(served.page.text).not.toContain('#directory-guide-terminology');
  });

  it('answers 404 under /debug once the caller is known, as on any other path', async () => {
    const authorized = { authorization: `Bearer ${acmeAdmin.key}` };
    const answers = [await served.fetched('/debug/tools', authorized), await served.fetched('/debug/tools')];
    expect(answers.map(({ status }) => status)).toEqual([404, 401]);
  });
});

describe('the page at /debug, for a server that answers it without these routes', () => {
  it('is the same document, with the same headers', async () => {
    const { html, headers } = await debugPageAnswerOf(debugServing, await debugStyleOnDisk());
    expect(html).toBe(served.page.text);
    expect(
      Object.entries(headers).filter(
        ([name, value]: readonly [string, string]) => served.page.headers.get(name) !== value,
      ),
    ).toEqual([]);
    expect(headers['content-security-policy']).toContain("default-src 'none'");
  });
});

function toolNamed(name: string): ShownTool {
  return { name, title: name, description: `Does ${name}.`, hints: [], arguments: [] };
}

function groupsOf(names: readonly string[]): readonly (readonly [string, readonly string[]])[] {
  return toolGroupsOf(names.map((name) => toolNamed(name))).map(({ name, tools }) => [
    name,
    tools.map((tool) => tool.name),
  ]);
}

describe('the groups of the tools of a connection', () => {
  it('holds each tool in its group, in the order of the group, and those of no group under Other', () => {
    expect(groupsOf(['get_guide', 'add_note', 'list_runs', 'get_run', 'run_definition', 'list_notes'])).toEqual([
      ['Runs', ['run_definition', 'get_run', 'list_runs']],
      ['Guides', ['get_guide']],
      ['Other', ['add_note', 'list_notes']],
    ]);
  });

  it('leaves out a group with no tool', () => {
    expect(groupsOf(['get_asset'])).toEqual([['Assets', ['get_asset']]]);
  });
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
