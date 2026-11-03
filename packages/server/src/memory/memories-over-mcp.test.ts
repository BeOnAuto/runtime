import { toolNamesIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sentenceNaming } from '../testing/interaction-servers/meetings-server.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const memoryTools = ['remember', 'recall', 'forget'];

const PromptsSchema = Schema.Struct({ prompts: Schema.Array(Schema.Struct({ name: Schema.String })) });

const PromptSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.optionalKey(Schema.String) }) })),
});

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
});

afterAll(async () => {
  await server.stop();
});

function on<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return on('/orgs/acme/playbooks/alpha/mcp', use);
}

async function promptsOf(session: McpSession): Promise<readonly string[]> {
  return Schema.decodeUnknownSync(PromptsSchema)(await session.listPrompts()).prompts.map(({ name }) => name);
}

function listedOf(names: readonly string[]): readonly string[] {
  return memoryTools.filter((name) => names.includes(name));
}

describe('the tools of memories over MCP', () => {
  it("are listed on /mcp and on the playbook's own endpoint, each with the recipe that keeps a memory", async () => {
    const onThePlaybook = await onAlpha(async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      prompts: await promptsOf(session),
    }));
    const onTheOrg = await on('/mcp', async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      prompts: await promptsOf(session),
    }));

    expect([listedOf(onThePlaybook.tools), onThePlaybook.prompts.includes('remember')]).toEqual([memoryTools, true]);
    expect([listedOf(onTheOrg.tools), onTheOrg.prompts.includes('remember')]).toEqual([memoryTools, true]);
  });

  it('keep what the person wants kept, and recall it as data the agent is told is no instruction', async () => {
    const { kept, recalled } = await onAlpha(async (session) => ({
      kept: await session.callTool('remember', { text: 'Ship releases on Thursdays', tags: ['releases'] }),
      recalled: await session.callTool('recall', { words: 'thursdays' }),
    }));

    const onTheOrg = await on('/mcp', async (session) => ({
      kept: await session.callTool('remember', { playbook: 'alpha', text: 'Ship releases on Thursdays' }),
      recalled: await session.callTool('recall', { playbook: 'alpha', words: 'thursdays' }),
    }));

    expect(kept.structuredContent).toMatchObject({ version: 1, scope: 'playbook' });
    expect(onTheOrg.recalled.structuredContent).toMatchObject({
      memories: [{ id: onTheOrg.kept.structuredContent?.['id'], text: 'Ship releases on Thursdays' }],
    });
    expect(recalled.structuredContent).toMatchObject({
      memories: [{ id: kept.structuredContent?.['id'], text: 'Ship releases on Thursdays', tags: ['releases'] }],
    });
  });
});

describe('episode 11: asked to keep what the team decided, to ask for it later', () => {
  it('finds in the instructions of /mcp that a memory function keeps what the playbook recalls later, and a recipe that keeps it so', async () => {
    const { instructions, prompt } = await on('/mcp', async (session) => ({
      instructions: String(session.instructions),
      prompt: Schema.decodeUnknownSync(PromptSchema)(
        await session.getPrompt('remember', { what: 'who approves a budget' }),
      ),
    }));

    expect(sentenceNaming(instructions, 'recalls later')).toBe(
      'A memory function keeps what the playbook recalls later.',
    );
    expect(String(prompt.messages[0]?.content.text)).toContain(
      '2. Keep each fact with remember, one memory a fact, in plain words with a few tags to find it by:',
    );
  });
});
