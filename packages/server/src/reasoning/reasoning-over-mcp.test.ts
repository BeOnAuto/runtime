import {
  danglingReferencesIn,
  guideToolName,
  listedTools,
  problemIn,
  textOf,
  withMcpSession,
  type McpSession,
} from '@on.auto/api/testing';
import { answers, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

const definitionTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'list_playbook_events',
  'get_event',
  'publish_event',
  'search',
  'introspect',
  'dry_run',
  'execute',
  'answer_interaction',
  'list_interactions',
  'send_run_event',
];

const withAnthropicThroughGateway = {
  MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
  MODEL_ALIASES: JSON.stringify({ 'anthropic/*': 'gateway/anthropic/*' }),
};

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(replies: readonly ScriptedReply[], use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingReasoning(replies);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

describe('a reasoning function definition over MCP, on the endpoint of its playbook', () => {
  it('is created, executed and read back with its run', async () => {
    const { created, ran, run } = await onAlpha([answers(textResult('Profits rose.'))], async (session) => {
      const creating = await session.callTool('create_definition', {
        type: 'reasoning',
        name: 'summary',
        source: summary,
      });
      const running = await session.callTool('run_definition', {
        type: 'reasoning',
        name: 'summary',
        input: { text: 'the quarter' },
      });
      const reading = await session.callTool('get_run', {
        run_id: String(running.structuredContent?.['run_id']),
      });
      return { created: creating, ran: running, run: reading };
    });

    expect(created.structuredContent).toMatchObject({ type: 'reasoning', name: 'summary', version: 1 });
    expect(ran.structuredContent).toMatchObject({ status: 'succeeded', output: 'Profits rose.' });
    expect(run.structuredContent).toMatchObject({
      status: 'succeeded',
      output: 'Profits rose.',
      record: { prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter', truncated: false } },
    });
    expect(server.modelCalls()).toBe(1);
  });

  it('answers an input the definition rejects with isError and the problem document', async () => {
    const ran = await onAlpha([], async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'summary', source: summary });
      return session.callTool('run_definition', { type: 'reasoning', name: 'summary', input: { text: 7 } });
    });

    expect({ isError: ran.isError, problem: problemIn(ran) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        errors: [{ pointer: '/input/text', detail: 'text: expected text.' }],
      },
    });
    expect(server.modelCalls()).toBe(0);
  });
});

describe('the definition tools an agent sees on the endpoint of a playbook', () => {
  it('are the eighteen operations inside a playbook and the guide tool, none of them carrying the format of a document', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));

    expect(tools.map(({ name }) => name)).toEqual([...definitionTools, guideToolName]);
    expect(tools.filter(({ description = '' }) => description.includes('Front matter'))).toEqual([]);
  });

  it('send an agent to the guide that ends with the providers and named models the server calls', async () => {
    server = await servingReasoning([], withAnthropicThroughGateway);
    const guide = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, (session) =>
      session.callTool(guideToolName, { guide: 'reasoning-function' }),
    );

    expect(textOf(guide)).toMatch(
      /On this server, a reasoning function names its model through gateway, written gateway\/<model id>, or one of the models its operator named: anthropic\/\*, where a name that ends in \* stands for any model id, so anthropic\/<model id> runs; it may name the tools of the tool servers that search finds\.\n$/u,
    );
  });

  it('have self-contained input schemas with an object root', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));
    const schemas = tools.map(({ inputSchema }) => inputSchema);

    expect(schemas).toHaveLength(20);
    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });
});
