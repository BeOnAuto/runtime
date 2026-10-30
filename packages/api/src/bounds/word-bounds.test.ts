import { unsuccessfulWords } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { asking, sentencesOf } from '../testing/asking-operation.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { plainTextIn, withMcpSession, type ToolResult } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

async function plainWordsOf(operation: ReturnType<typeof asking>, question?: string): Promise<string> {
  const server = await operationServer({ operations: [operation] });
  const listening = await listenOnLoopback(server.handler);
  const result: ToolResult = await withMcpSession(
    'current revision',
    { url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    (session) => session.callTool(operation.registration.name, question === undefined ? {} : { question }),
  );
  await listening.close();
  await server.runtime.dispose();
  return plainTextIn(result);
}

describe('the words of an outcome', () => {
  it('are served whole at 400 characters, and cut at a sentence with the rest in the details at 401', async () => {
    const first = sentencesOf(199);

    expect(await plainWordsOf(asking({ outcome: `${first} ${sentencesOf(200)}` }))).toBe(
      `${first} ${sentencesOf(200)}`,
    );
    expect(await plainWordsOf(asking({ outcome: `${first} ${sentencesOf(201)}` }))).toBe(
      `${first} The rest is in the details below.`,
    );
  });
});

function refusalWordsOf(attempt: string): string {
  return unsuccessfulWords(attempt, 'query', { status: 'rejected', reason: 'not_found', detail: 'There is nothing' });
}

describe('the words of a refusal', () => {
  it('are served whole at 600 characters, and cut with the rest in the details at 601', async () => {
    const attemptAt = (length: number) => 'a'.repeat(length - refusalWordsOf('').length);

    expect(await plainWordsOf(asking({ attempt: attemptAt(600) }), 'nothing')).toBe(refusalWordsOf(attemptAt(600)));
    expect(
      (await plainWordsOf(asking({ attempt: attemptAt(601) }), 'nothing')).endsWith(
        ' The rest is in the details below.',
      ),
    ).toBe(true);
  });
});
