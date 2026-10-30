import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { messagesIn, postMcp, type RawAnswer } from '../testing/mcp-requests.ts';
import { acmeAdmin, acmeAlphaWriter, operationServer } from '../testing/operation-server.ts';

const TextBlock = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String });

const ToolErrorSchema = Schema.Struct({
  id: Schema.Number,
  result: Schema.Struct({
    isError: Schema.Literal(true),
    content: Schema.Tuple([TextBlock, TextBlock]),
  }),
});

const toolErrorOf = Schema.decodeUnknownSync(ToolErrorSchema);

function problemsIn(answer: RawAnswer): readonly unknown[] {
  return messagesIn(answer).map((message) => {
    const parsed: unknown = JSON.parse(toolErrorOf(message).result.content[1].text);
    return parsed;
  });
}

function toolCall(name: string, argumentsText: string): string {
  return `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"${name}","arguments":${argumentsText}}}`;
}

function under2025(key: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-11-25' };
}

const protoCalls: ReadonlyArray<readonly [string, string, string]> = [
  ['/mcp', 'add_note', '{"playbook":"alpha","name":"proto","text":"t","__proto__":"x"}'],
  ['/mcp', 'label_playbook', '{"playbook":"alpha","label":"l","__proto__":{"admin":true}}'],
  ['/orgs/acme/mcp', 'label_playbook', '{"playbook":"alpha","label":"l","__proto__":{"admin":true}}'],
  ['/orgs/acme/playbooks/alpha/mcp', 'add_note', '{"name":"proto","text":"t","__proto__":"x"}'],
];

describe('a __proto__ argument', () => {
  it.each(protoCalls)('is rejected on %s by %s as an excess field, as over HTTP', async (path, name, argumentsText) => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, path, under2025(acmeAdmin.key), toolCall(name, argumentsText));

    expect(problemsIn(answer)).toEqual([
      {
        type: 'https://on.auto/problems/invalid_input',
        title: 'Invalid input',
        status: 422,
        detail: 'The input does not match the input schema',
        reason: 'invalid_input',
        errors: [{ detail: 'Expected no excess property', pointer: '/__proto__' }],
      },
    ]);
  });

  it('is judged after the caller, as over HTTP', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(
      handler,
      '/mcp',
      under2025(acmeAlphaWriter.key),
      toolCall('add_note', '{"playbook":"beta","name":"proto","text":"t","__proto__":"x"}'),
    );

    expect(problemsIn(answer)).toMatchObject([{ reason: 'forbidden' }]);
  });
});

describe('a malformed playbook argument on /mcp', () => {
  it('is invalid_input at /playbook before anything else, even for a key limited to other playbooks', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(
      handler,
      '/mcp',
      under2025(acmeAlphaWriter.key),
      toolCall('list_notes', '{"playbook":"Beta"}'),
    );

    expect(problemsIn(answer)).toMatchObject([
      {
        reason: 'invalid_input',
        errors: [{ detail: 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{2,47}$', pointer: '/playbook' }],
      },
    ]);
  });
});
