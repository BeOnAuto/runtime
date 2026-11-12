import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { answerDocument } from '../bounds/tool-results.ts';
import { patientTiming, playbookToolCalls, reportingAccess, threadReplies } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeExecuted = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ text: Schema.String, answer: Schema.optionalKey(Schema.Json) }) }),
);

async function executedAndCalled(
  tool: string,
  input: Readonly<Record<string, unknown>> = {},
  tools: readonly FakeTool[] = [],
) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, data: true, tools });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  const settled = await playbookToolCalls(access).call('execute_connection', {
    server: 'graph',
    tool,
    arguments: input,
  });
  const executed = decodeExecuted(settled).output;
  const call = { org: 'acme', playbook: 'alpha', reference: { server: 'graph', tool }, input, meta: {} };
  const called = await Effect.runPromise(access.callOnce(call));
  return {
    executed,
    document: called.kind === 'answered' && called.outcome === 'result' ? answerDocument(called.answer) : undefined,
  };
}

const rowsFile = { uri: 'file:///rows.json', mimeType: 'application/json', text: '{"rows":2}' };

function answering(name: string, answer: FakeTool['answer']): FakeTool {
  return {
    name,
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
    answer,
  };
}

const pdf = { uri: 'file:///rows.pdf', mimeType: 'application/pdf', blob: 'JVBERi0K' };

const filesAnswered: readonly FakeTool[] = [
  answering('file', () => ({ content: [{ type: 'resource', resource: rowsFile }] })),
  answering('line_and_file', () => ({
    content: [
      { type: 'text', text: 'Read rows.json.' },
      { type: 'resource', resource: rowsFile },
    ],
  })),
  answering('blob', () => ({ content: [{ type: 'resource', resource: pdf }] })),
];

describe('the answer of a call made by hand', () => {
  it('is the document a call reads, the structure beside a summary the model sees', async () => {
    const { executed, document } = await executedAndCalled('thread');

    expect(executed).toEqual({
      text: '2 replies in the thread.',
      answer: { ok: true, messages: threadReplies, has_more: false },
    });
    expect(executed.answer).toEqual(document);
  });

  it('is every text block joined in order, read as JSON where the joined text is JSON, else as that text', async () => {
    const blocks = await executedAndCalled('blocks');
    const plain = await executedAndCalled('search', { query: 'acme' });

    expect([blocks.executed.answer, plain.executed.answer]).toEqual([
      '{"page":1}\n{"page":2}',
      'Found 2 rows for acme.',
    ]);
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

describe('the answer of a call made by hand of a tool that answered a file', () => {
  it('is the text of the file, after the blocks before it, and never a blob', async () => {
    const file = await executedAndCalled('file', {}, filesAnswered);
    const lineAndFile = await executedAndCalled('line_and_file', {}, filesAnswered);
    const blob = await executedAndCalled('blob', {}, filesAnswered);

    expect([file.executed, lineAndFile.executed, blob.executed]).toEqual([
      { text: '{"rows":2}', answer: { rows: 2 } },
      { text: 'Read rows.json.\n{"rows":2}', answer: 'Read rows.json.\n{"rows":2}' },
      { text: '[resource content (application/pdf), not shown]' },
    ]);
    expect([file.document, lineAndFile.document, blob.document]).toEqual([
      { rows: 2 },
      'Read rows.json.\n{"rows":2}',
      undefined,
    ]);
  });
});
