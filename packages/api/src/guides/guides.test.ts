import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiShippedRoots } from '../index.ts';
import { recipesFollowedWith } from '../mcp/instructions.ts';
import { servedWithCards, servedWithInteraction } from '../testing/guide-shelves.ts';
import { testGuides, testRecipes, testShelf, testShelfWithGoals } from '../testing/guides.ts';
import { type Listening, listenOnLoopback } from '../testing/listening.ts';
import {
  mcpClientKinds,
  type McpSession,
  plainTextIn,
  problemIn,
  textOf,
  withMcpSession,
} from '../testing/mcp-clients.ts';
import { acmeAdmin, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { playbookEndpoint, recipes } from '../testing/served-instructions.ts';
import { guideToolName, listedTools } from '../testing/tool-listing.ts';
import { goalsFirstGuideWords, guideToolDefinitionOf, guideToolDescription } from './guide-tool.ts';
import { withLinksResolved } from './page-links.ts';
import { guideShelfFrom } from './served-guides.ts';
import { withoutSiteMarkup } from './site-markup.ts';

let server: OperationServer;

let listening: Listening;

const endpoints = ['/mcp', '/orgs/acme/mcp', '/orgs/acme/playbooks/alpha/mcp'];

const everyGuide = [...testGuides, ...testRecipes];

const ResourcesSchema = Schema.Struct({
  resources: Schema.Array(
    Schema.Struct({
      uri: Schema.String,
      name: Schema.String,
      title: Schema.String,
      description: Schema.String,
      mimeType: Schema.String,
      annotations: Schema.Struct({ audience: Schema.Array(Schema.String) }),
    }),
  ),
});

const ContentsSchema = Schema.Struct({
  contents: Schema.Array(Schema.Struct({ uri: Schema.String, mimeType: Schema.String, text: Schema.String })),
});

function on<T>(path: string, use: (session: McpSession) => Promise<T>, key = acmeAdmin.key): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

function guideDescribedOn(path: string, key = acmeAdmin.key): Promise<string | undefined> {
  return on(
    path,
    async (session) => listedTools(await session.listTools()).find(({ name }) => name === guideToolName)?.description,
    key,
  );
}

function page(path: string): string {
  return readFileSync(new URL(`../../../../docs/${path}`, import.meta.url), 'utf8');
}

describe('guides', () => {
  beforeAll(async () => {
    server = await operationServer();
    listening = await listenOnLoopback(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('the guide tool', () => {
    it.each(endpoints)(
      'is listed on %s, read-only, with the names of the guides as the values of its argument',
      async (path) => {
        const tools = listedTools(await on(path, (session) => session.listTools()));
        const guideTool = tools.find(({ name }) => name === guideToolName);

        expect(guideTool).toMatchObject({
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: { guide: { type: 'string', enum: everyGuide.map(({ name }) => name) } },
            required: ['guide'],
            additionalProperties: false,
          },
        });
      },
    );
  });

  describe('what the guide tool says of the recipes', () => {
    const following = `${guideToolDescription} It holds the recipe take-a-note, which the tools listed here can follow.`;

    it('names the recipe the tools of /mcp and of the playbook endpoint can follow, and none on the org endpoint, which can follow none', async () => {
      expect(await Promise.all(endpoints.map((path) => guideDescribedOn(path)))).toEqual([
        following,
        guideToolDescription,
        following,
      ]);
    });

    it('names no recipe to a key that may only read, whose tools can follow none', async () => {
      expect(await guideDescribedOn('/mcp', acmeReader.key)).toBe(guideToolDescription);
    });

    it('names in turn the recipes a playbook endpoint can follow', () => {
      expect(guideToolDefinitionOf(testShelf, recipesFollowedWith(playbookEndpoint, recipes)).description).toBe(
        `${guideToolDescription} It holds the recipes give-tools, schedule and keep, which the tools listed here can follow.`,
      );
    });

    it('leads with reading the start and the goals guides where the shelf holds the guide goals', () => {
      expect(guideToolDefinitionOf(testShelfWithGoals, []).description).toBe(
        `${goalsFirstGuideWords} ${guideToolDescription}`,
      );
      expect(goalsFirstGuideWords).toBe(
        'Read the start guide before anything else, and the goals guide before you make anything: here a playbook is made only with goals learned from the person.',
      );
    });
  });

  describe('the guide tool, for any key', () => {
    it('is offered to a key that may only read', async () => {
      const tools = listedTools(await on('/mcp', (session) => session.listTools(), acmeReader.key));

      expect(tools.map(({ name }) => name)).toContain(guideToolName);
    });

    it('answers the whole text of each guide, and nothing else', async () => {
      const answers = await on('/mcp', (session) =>
        Promise.all(everyGuide.map(({ name }) => session.callTool(guideToolName, { guide: name }))),
      );

      expect(
        answers.map((answer) => ({ isError: answer.isError, text: textOf(answer), content: answer.content.length })),
      ).toEqual(everyGuide.map(({ text }) => ({ isError: undefined, text, content: 1 })));
    });

    it('refuses a guide it does not carry, a guide that is not named and an argument it does not take, as invalid input', async () => {
      const [unknown, unnamed, extra] = await on('/mcp', (session) =>
        Promise.all([
          session.callTool(guideToolName, { guide: 'cooking' }),
          session.callTool(guideToolName, {}),
          session.callTool(guideToolName, { guide: 'notebook', page: 2 }),
        ]),
      );

      expect(problemIn(unknown)).toMatchObject({
        reason: 'invalid_input',
        errors: [{ detail: 'There is no guide cooking', pointer: '/guide' }],
      });
      expect(plainTextIn(unknown)).toBe(
        'Could not read the guide: what was given does not fit what it needs. This can be corrected and tried again; the details below say what to change.',
      );
      expect(problemIn(unnamed)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/guide' }] });
      expect(problemIn(extra)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/page' }] });
    });
  });

  describe.each(mcpClientKinds)('the guides as resources, for the %s client', (kind) => {
    it('are listed as the same guides, in Markdown, for the assistant, and read as the same text', async () => {
      const outcome = await withMcpSession(
        kind,
        {
          url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`,
          headers: { authorization: `Bearer ${acmeAdmin.key}` },
        },
        async (session) => ({
          listed: Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources()),
          read: await Promise.all(
            everyGuide.map(async ({ name }) =>
              Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(`guide://${name}`)),
            ),
          ),
        }),
      );

      expect(outcome.listed.resources).toEqual(
        everyGuide.map(({ name, title, description }) => ({
          uri: `guide://${name}`,
          name,
          title,
          description,
          mimeType: 'text/markdown',
          annotations: { audience: ['assistant'] },
        })),
      );
      expect(outcome.read).toEqual(
        everyGuide.map(({ name, text }) => ({
          contents: [{ uri: `guide://${name}`, mimeType: 'text/markdown', text }],
        })),
      );
    });
  });
});

describe('the guides of a server that serves an interaction function with a companion guide', () => {
  it('carry the companion right after the format guide of its type, made of its page', () => {
    const names = servedWithCards.guides.map(({ name }) => name);

    expect(names.slice(names.indexOf('interaction-function'), names.indexOf('interaction-function') + 2)).toEqual([
      'interaction-function',
      'render-slack',
    ]);
    expect(servedWithCards.named('render-slack')).toEqual({
      name: 'render-slack',
      title: 'Cards for Slack',
      description: 'How to write a message to Slack as a card.',
      text: withLinksResolved(withoutSiteMarkup(page('reference/render-slack.md')), 'reference/render-slack.md'),
    });
    expect(servedWithCards.named('render-slack')?.text.startsWith('# Cards for Slack')).toBe(true);
  });

  it('carry none where the type serves none', () => {
    expect(servedWithInteraction.named('render-slack')).toBeUndefined();
  });
});

it('refuses to start without the format page of a type the server runs', async () => {
  await expect(
    guideShelfFrom(
      shippedFilesOnDisk(apiShippedRoots()),
      [{ type: 'drafting', noun: { one: 'draft', other: 'drafts' }, guide: { name: 'drafting-function' } }],
      { pages: false },
    ),
  ).rejects.toThrow(/no such file or directory.*drafting-format\.md/u);
});

describe('the links of a page served as a guide', () => {
  it('point a relative link at the published page, with its fragment', () => {
    expect(
      withLinksResolved(
        'See [Tool servers](http.md#tool-servers) and [Availability](../concepts/functions.md#availability).',
        'reference/reasoning-format.md',
      ),
    ).toBe(
      'See [Tool servers](https://on.auto/docs/reference/http#tool-servers) and [Availability](https://on.auto/docs/concepts/functions#availability).',
    );
  });

  it('keep a link that is already absolute, and keep only the words of a link within the page', () => {
    expect(
      withLinksResolved(
        '[the guide](https://example.com/guide) and [When a run fails](#when-a-run-fails)',
        'reference/computation-format.md',
      ),
    ).toBe('[the guide](https://example.com/guide) and When a run fails');
  });

  it('leave what looks like a link inside a block of code as it is', () => {
    const pagePageLinks = 'Before [it](http.md).\n\n```ts\nview[campaign](x)\n```\n\nAfter [it](http.md).\n';

    expect(withLinksResolved(pagePageLinks, 'reference/computation-format.md')).toBe(
      'Before [it](https://on.auto/docs/reference/http).\n\n```ts\nview[campaign](x)\n```\n\nAfter [it](https://on.auto/docs/reference/http).\n',
    );
  });
});
