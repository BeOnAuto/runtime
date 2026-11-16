import { beforeGoingOnOf, unsuccessfulWords, type Notice } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { asking, sentencesOf } from '../testing/asking-operation.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { plainTextIn, withMcpSession, type ToolResult } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

async function resultOf(operation: ReturnType<typeof asking>, question?: string): Promise<ToolResult> {
  const server = await operationServer({ operations: [operation] });
  const listening = await listenOnLoopback(server.handler);
  const result: ToolResult = await withMcpSession(
    'current revision',
    { url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    (session) => session.callTool(operation.registration.name, question === undefined ? {} : { question }),
  );
  await listening.close();
  await server.runtime.dispose();
  return result;
}

async function plainWordsOf(operation: ReturnType<typeof asking>, question?: string): Promise<string> {
  return plainTextIn(await resultOf(operation, question));
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

const aNotice: Notice = { kind: 'checked', detail: 'Check it.', certainty: 'likely' };

describe('the words of an outcome with notices', () => {
  it('leave what to do with the notices to before_going_on, so a model reading both reads it once', async () => {
    const fits = sentencesOf(400);

    const result = await resultOf(asking({ outcome: fits, notices: [aNotice] }));

    expect(plainTextIn(result)).toBe(fits);
    expect(JSON.stringify(result.structuredContent).split(beforeGoingOnOf(1))).toHaveLength(2);
  });
});

describe('the structured answer of an outcome', () => {
  it('starts with the words of the outcome as in_words, the same words its first text gives, cut the same', async () => {
    const first = sentencesOf(199);

    const result = await resultOf(asking({ outcome: `${first} ${sentencesOf(201)}` }));

    expect(Object.entries({ ...result.structuredContent })).toEqual([
      ['in_words', `${first} The rest is in the details below.`],
      ['answered', true],
    ]);
    expect(plainTextIn(result)).toBe(`${first} The rest is in the details below.`);
  });

  it('carries the words to relay as in_words, the same words its first text gives', async () => {
    const result = await resultOf(asking({ outcome: 'Asked.', relayed: 'Relayed.' }));

    expect(result.structuredContent).toEqual({ in_words: 'Relayed.', answered: true });
    expect(plainTextIn(result)).toBe('Relayed.');
  });

  it('leaves in_words out when the words to relay are a field the output already holds, so the model reads them once', async () => {
    const result = await resultOf(asking({ outcome: 'Asked.', relayed: 'Relayed.', told: 'Relayed.' }));

    expect(result.structuredContent).toEqual({ answered: true, told: 'Relayed.' });
    expect(plainTextIn(result)).toBe('Relayed.');
  });

  it('leaves in_words out when the words of the outcome are a field the output already holds', async () => {
    const result = await resultOf(asking({ outcome: 'Told.', told: 'Told.' }));

    expect(result.structuredContent).toEqual({ answered: true, told: 'Told.' });
    expect(plainTextIn(result)).toBe('Told.');
  });

  it('leaves the second text the output alone, so a client that shows only the texts reads the words once', async () => {
    const result = await resultOf(asking({ outcome: 'Asked.' }));

    expect(result.content.map(({ text }) => text)).toEqual(['Asked.', JSON.stringify({ answered: true })]);
  });
});

describe('the structured answer of an outcome with notices', () => {
  it('starts with the words, then the notices and the sentence that says what to do with them', async () => {
    const result = await resultOf(asking({ outcome: 'Asked.', notices: [aNotice] }));

    expect(Object.entries({ ...result.structuredContent }).slice(0, 3)).toEqual([
      ['in_words', 'Asked.'],
      ['notices', [aNotice]],
      ['before_going_on', beforeGoingOnOf(1)],
    ]);
    expect(plainTextIn(result)).toBe('Asked.');
  });
});

describe('the words to relay', () => {
  it('are served whole at 1,000 characters in place of the outcome, and cut at a sentence with the rest in the details at 1,001', async () => {
    const first = sentencesOf(499);
    const outcome = 'Asked.';

    expect(await plainWordsOf(asking({ outcome, relayed: `${first} ${sentencesOf(500)}` }))).toBe(
      `${first} ${sentencesOf(500)}`,
    );
    expect(await plainWordsOf(asking({ outcome, relayed: `${first} ${sentencesOf(501)}` }))).toBe(
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
