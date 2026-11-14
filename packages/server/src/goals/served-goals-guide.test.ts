import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

let kept: ReasoningServer;
let notKept: ReasoningServer;

beforeAll(async () => {
  [kept, notKept] = await Promise.all([servingReasoningWithGoals([]), servingReasoning([])]);
});

afterAll(async () => {
  await Promise.all([kept.stop(), notKept.stop()]);
});

const ResourcesSchema = Schema.Struct({ resources: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ToolSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.String })),
  isError: Schema.optional(Schema.Boolean),
});

const ListedSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      inputSchema: Schema.Struct({
        properties: Schema.Struct({ guide: Schema.optional(Schema.Struct({ enum: Schema.Array(Schema.String) })) }),
      }),
    }),
  ),
});

function onMcp<T>(server: ReasoningServer, path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

function goalsGuideOn(server: ReasoningServer, path: string) {
  return onMcp(server, path, async (session) => {
    const { tools } = Schema.decodeUnknownSync(ListedSchema)(await session.listTools());
    const { resources } = Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources());
    const read = Schema.decodeUnknownSync(ToolSchema)(await session.callTool('get_guide', { guide: 'goals' }));
    const start = Schema.decodeUnknownSync(ToolSchema)(await session.callTool('get_guide', { guide: 'start' }));
    const terms = Schema.decodeUnknownSync(ToolSchema)(await session.callTool('get_guide', { guide: 'terminology' }));
    return {
      offered: tools.find(({ name }) => name === 'get_guide')?.inputSchema.properties.guide?.enum.includes('goals'),
      resource: resources.some(({ name }) => name === 'goals'),
      read: { isError: read.isError === true, text: read.content.map(({ text }) => text).join('') },
      start: start.content.map(({ text }) => text).join(''),
      terms: terms.content.map(({ text }) => text).join(''),
    };
  });
}

const startsItsGoals = "\n## Its goals\n\nA goal is what the playbook is for, in the person's own words:";

const termsOfGoals = "\nGoals:\n\n- Goal: What a playbook is for, in the person's own words,";

const asksBeforeTheCreate =
  'or use the playbook they name when list_playbooks shows it. Here a playbook is made only with its goals, so before you create it, ask the person: What should this playbook achieve for you, and how will you know it worked?';

const endpoints = ['/mcp', '/directory', '/orgs/local/mcp', '/orgs/local/playbooks/alpha/mcp'] as const;

describe('the goals guide of a server that keeps goals', () => {
  it.each(endpoints)('is offered by get_guide on %s, listed as a resource and read whole', async (path) => {
    const { offered, resource, read, start, terms } = await goalsGuideOn(kept, path);

    expect({ offered, resource, isError: read.isError }).toEqual({ offered: true, resource: true, isError: false });
    expect(read.text).toMatch(/^# Goals\n\nThe goals of a playbook say what it should achieve for the person/u);
    expect(start).toContain(startsItsGoals);
    expect(terms).toContain(termsOfGoals);
  });

  it('is read at its route, and the first-playbook recipe asks for the goals before the playbook is created', async () => {
    const [guide, recipe] = await Promise.all(
      ['/v1/guides/goals', '/v1/guides/first-playbook'].map((path) => fetch(`${kept.origin}${path}`)),
    );

    expect(guide?.status).toBe(200);
    expect(await guide?.text()).toContain('# Goals\n');
    expect(await recipe?.text()).toContain(asksBeforeTheCreate);
  });
});

describe('the goals guide of a server that keeps no goals', () => {
  it.each(endpoints)('is not offered on %s, and get_guide answers that there is no such guide', async (path) => {
    const { offered, resource, read, start, terms } = await goalsGuideOn(notKept, path);

    expect({ offered, resource, isError: read.isError }).toEqual({ offered: false, resource: false, isError: true });
    expect(read.text).toContain('There is no guide goals');
    expect(start).not.toContain('goals');
    expect(terms).not.toContain('Goal');
  });

  it('is unknown at its route, and the first-playbook recipe says nothing of goals', async () => {
    const [guide, recipe] = await Promise.all(
      ['/v1/guides/goals', '/v1/guides/first-playbook'].map((path) => fetch(`${notKept.origin}${path}`)),
    );

    expect(guide?.status).toBe(404);
    expect(await recipe?.text()).not.toContain('goals');
  });
});
