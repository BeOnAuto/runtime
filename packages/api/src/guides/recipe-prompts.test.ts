import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notebookGuide, noteRecipe } from '../testing/guides.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { mcpClientKinds, withMcpSession, type McpSession } from '../testing/mcp-clients.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { acmeAdmin, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function onMcp<T>(kind: (typeof mcpClientKinds)[number], use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    kind,
    { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    use,
  );
}

const PromptNamesSchema = Schema.Struct({ prompts: Schema.Array(Schema.Struct({ name: Schema.String })) });

async function promptsListedOn(path: string, key: string): Promise<readonly string[]> {
  const listed = await withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    (session) => session.listPrompts(),
  );
  return Schema.decodeUnknownSync(PromptNamesSchema)(listed).prompts.map(({ name }) => name);
}

function promptAnswer(request: string) {
  return {
    description: noteRecipe.description,
    messages: [
      { role: 'user', content: { type: 'text', text: `${request}\n\n${noteRecipe.text}` } },
      {
        role: 'user',
        content: {
          type: 'resource',
          resource: { uri: 'guide://notebook', mimeType: 'text/markdown', text: notebookGuide.text },
        },
      },
    ],
  };
}

describe.each(mcpClientKinds)('the recipes as prompts, for the %s client', (kind) => {
  it('are listed with their titles and their arguments', async () => {
    expect(await onMcp(kind, (session) => session.listPrompts())).toMatchObject({
      prompts: [
        {
          name: 'take-a-note',
          title: 'Take a note',
          description: 'Adds a note the person dictates.',
          arguments: [
            { name: 'text', description: 'What the note says', required: true },
            { name: 'name', description: 'The name of the note', required: false },
          ],
        },
      ],
    });
  });

  it('answer the recipe with the words of the person filled in, then the guide it needs as an embedded resource', async () => {
    const answers = await onMcp(kind, async (session) => [
      await session.getPrompt('take-a-note', { text: 'buy milk' }),
      await session.getPrompt('take-a-note', { text: 'buy milk', name: 'shopping' }),
    ]);

    expect(answers).toMatchObject([
      promptAnswer('Take a note that says buy milk.'),
      promptAnswer('Take the note shopping: buy milk.'),
    ]);
  });
});

describe('a recipe asked without the words it needs', () => {
  it('is a protocol error that names the argument', async () => {
    await expect(onMcp('current revision', (session) => session.getPrompt('take-a-note'))).rejects.toThrow(
      /Invalid arguments for prompt take-a-note/u,
    );
  });
});

describe('a recipe asked without any arguments at all', () => {
  it('is read as asked with none, so the error names the argument it needs', async () => {
    const answer = await postMcp(
      server.handler,
      '/mcp',
      { authorization: `Bearer ${acmeAdmin.key}`, 'mcp-protocol-version': '2025-11-25' },
      requestOf(1, 'prompts/get', { name: 'take-a-note' }),
    );

    expect(JSON.stringify(messagesIn(answer))).toMatch(
      /"code":-32602,"message":"Invalid arguments for prompt take-a-note: [^"]*text/u,
    );
  });
});

describe('the prompts of a connection', () => {
  it('are the recipes whose every tool the connection lists for its key', async () => {
    const listed = await Promise.all([
      promptsListedOn('/orgs/acme/playbooks/alpha/mcp', acmeAdmin.key),
      promptsListedOn('/orgs/acme/mcp', acmeAdmin.key),
      promptsListedOn('/mcp', acmeReader.key),
    ]);

    expect(listed).toEqual([['take-a-note'], [], []]);
  });

  it('leave out a recipe the connection cannot follow, as a prompt it does not have', async () => {
    await expect(
      withMcpSession(
        'current revision',
        { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeReader.key}` } },
        (session) => session.getPrompt('take-a-note', { text: 'buy milk' }),
      ),
    ).rejects.toThrow(/Prompt take-a-note not found/u);
  });
});
