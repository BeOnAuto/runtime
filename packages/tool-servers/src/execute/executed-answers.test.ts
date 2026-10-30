import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { answerDocument } from '../bounds/tool-results.ts';
import { patientTiming, playbookToolCalls, reportingAccess, threadReplies } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeExecuted = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ text: Schema.String, answer: Schema.optionalKey(Schema.Json) }) }),
);

async function executedAndCalled(tool: string, input: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, data: true });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  const settled = await playbookToolCalls(access).call('execute', { server: 'graph', tool, arguments: input });
  const executed = decodeExecuted(settled).output;
  const call = { org: 'acme', playbook: 'alpha', reference: { server: 'graph', tool }, input, meta: {} };
  const called = await Effect.runPromise(access.callOnce(call));
  return {
    executed,
    document: called.kind === 'answered' && called.outcome === 'result' ? answerDocument(called.answer) : undefined,
  };
}

describe('the answer of a call made by hand', () => {
  it('is the document a call reads, the structure beside a summary the model sees', async () => {
    const { executed, document } = await executedAndCalled('thread');

    expect(executed).toEqual({
      text: '2 replies in the thread.',
      answer: { ok: true, messages: threadReplies, has_more: false },
    });
    expect(executed.answer).toEqual(document);
  });

  it('is the first of several text blocks read as JSON, and a text that is not JSON as that text', async () => {
    const blocks = await executedAndCalled('blocks');
    const plain = await executedAndCalled('search', { query: 'acme' });

    expect([blocks.executed.answer, plain.executed.answer]).toEqual([{ page: 1 }, 'Found 2 rows for acme.']);
    expect([blocks.executed.answer, plain.executed.answer]).toEqual([blocks.document, plain.document]);
  });

  it('is the structure of each page of a tool that pages, and the JSON of a text', async () => {
    const first = await executedAndCalled('pages');
    const last = await executedAndCalled('pages', { cursor: 'p2' });
    const counted = await executedAndCalled('strict', { limit: 3 });

    expect([first.executed.answer, last.executed.answer, counted.executed.answer]).toEqual([
      { items: [1, 2], next: 'p2' },
      { items: [3], next: null },
      { limit: 3 },
    ]);
  });

  it('is left out when the tool answered neither structured content nor text, and when it takes more than 64 KiB', async () => {
    const photo = await executedAndCalled('photo');
    const large = await executedAndCalled('large', { kib: 70 });

    expect(['answer' in photo.executed, 'answer' in large.executed]).toEqual([false, false]);
    expect([photo.document, typeof large.document]).toEqual([undefined, 'string']);
  });
});
