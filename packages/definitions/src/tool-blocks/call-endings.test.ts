import { compileJsonSchema } from '@on.auto/json-schema';
import type { AnsweredOnce, CallAnswer, CalledOnce, ToolMark } from '@on.auto/tool-servers';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { callEndingOf, type CalledDocument } from './call-endings.ts';

function documentOf(read?: string, output: Schema.JsonObject = {}): CalledDocument {
  const call = read === undefined ? { server: 'chat', tool: 'thread' } : { server: 'chat', tool: 'thread', read };
  return { call, output: { schema: Result.getOrThrow(compileJsonSchema(output, { what: 'output', nesting: 512 })) } };
}

const answeredFacts = {
  is_error: false,
  result_bytes: 12,
  result_sha256: 'd'.repeat(64),
  duration_ms: 3,
  jsonrpc_id: 1,
};

function answering(answer: CallAnswer, mark: ToolMark = 'reads'): AnsweredOnce {
  return { kind: 'answered', mark, detail: '', retryAfterMs: null, outcome: 'result', answer, answered: answeredFacts };
}

function failing(
  outcome: 'server_failure' | 'timed_out' | 'arguments_refused',
  mark: ToolMark,
  retryAfterMs: number | null = null,
): AnsweredOnce {
  return {
    kind: 'answered',
    mark,
    detail: 'it stopped',
    retryAfterMs,
    outcome,
    failed: { because: outcome, duration_ms: 3, jsonrpc_id: 1 },
  };
}

function erring(mark: ToolMark): AnsweredOnce {
  return {
    kind: 'answered',
    mark,
    detail: 'not allowed',
    retryAfterMs: null,
    outcome: 'tool_error',
    answered: { ...answeredFacts, is_error: true },
  };
}

function endedWith(document: CalledDocument, called: CalledOnce) {
  return Effect.runSync(Effect.exit(callEndingOf(document, called)));
}

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

const messages = [{ user: 'ada', text: 'Shipped.' }];

const mayHaveActed = '. The tool ran and may have changed something; a run again calls it again';

function nestedIn(levels: number): Schema.Json {
  return Array.from({ length: levels }).reduce<Schema.Json>((inner) => ({ n: inner }), 'leaf');
}

describe('a call that sent nothing', () => {
  it('is unavailable with the refusal of its call, a tool no longer marked reads among them', () => {
    const refusals: readonly CalledOnce[] = [
      { kind: 'unopened', refused: 'tool_not_offered', because: 'tool_not_listed', detail: 'Not listed' },
      { kind: 'unopened', refused: 'tool_server_failed', because: 'unreachable', detail: 'Not reached' },
      { kind: 'unopened', refused: 'tool_not_read_only', mark: 'acts', detail: 'Marked acts' },
    ];

    expect(refusals.map((called) => endedWith(documentOf(), called))).toEqual([
      rejectedWith({ _tag: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed', detail: 'Not listed' }),
      rejectedWith({ _tag: 'unavailable', kind: 'tool_server_failed', because: 'unreachable', detail: 'Not reached' }),
      rejectedWith({ _tag: 'unavailable', kind: 'tool_not_read_only', detail: 'Marked acts' }),
    ]);
  });
});

describe('a call that answered', () => {
  it('ends with the value at read, or the whole answer, its structured content or its text read as JSON, and the record of the call', () => {
    expect([
      endedWith(documentOf('/messages'), answering({ content: [], structuredContent: { messages } })),
      endedWith(documentOf(), answering({ content: [{ type: 'text', text: JSON.stringify(messages) }] })),
      endedWith(documentOf(), answering({ content: [{ type: 'text', text: 'Found 2 rows.' }] })),
    ]).toEqual([
      Exit.succeed({ output: messages, record: { server: 'chat', tool: 'thread', read: '/messages' } }),
      Exit.succeed({ output: messages, record: { server: 'chat', tool: 'thread' } }),
      Exit.succeed({ output: 'Found 2 rows.', record: { server: 'chat', tool: 'thread' } }),
    ]);
  });
});

const jsonFile = { type: 'resource', resource: { uri: 'file:///messages.json', text: JSON.stringify({ messages }) } };

const pdf = { type: 'resource', resource: { uri: 'file:///terms.pdf', mimeType: 'application/pdf', blob: 'JVBERi0K' } };

describe('a call whose answer carries a file', () => {
  it('reads the text of the file as it reads a text block, after the blocks before it, and never a blob', () => {
    expect([
      endedWith(documentOf('/messages'), answering({ content: [jsonFile] })),
      endedWith(documentOf(), answering({ content: [{ type: 'text', text: 'Read messages.json.' }, jsonFile, pdf] })),
      endedWith(
        documentOf('/messages'),
        answering({ content: [{ type: 'text', text: 'Read messages.json.' }, jsonFile] }),
      ),
      endedWith(documentOf(), answering({ content: [pdf] })),
    ]).toEqual([
      Exit.succeed({ output: messages, record: { server: 'chat', tool: 'thread', read: '/messages' } }),
      Exit.succeed({
        output: `Read messages.json.\n${JSON.stringify({ messages })}`,
        record: { server: 'chat', tool: 'thread' },
      }),
      rejectedWith({
        kind: 'unworkable',
        detail: 'The thread tool of chat answered text that is not JSON, which holds nothing at /messages',
      }),
      rejectedWith({
        kind: 'unworkable',
        detail: 'The thread tool of chat answered neither structured content nor text, so there is nothing to read',
      }),
    ]);
  });
});

describe('a call whose answer cannot be read', () => {
  it('is unworkable when the answer has no document, or nothing at read, in a structure or in a text', () => {
    expect([
      endedWith(documentOf(), answering({ content: [{ type: 'image', mimeType: 'image/png' }] })),
      endedWith(documentOf('/nothing'), answering({ content: [], structuredContent: { messages } })),
      endedWith(documentOf('/rows'), answering({ content: [{ type: 'text', text: 'Found 2 rows.' }] })),
    ]).toEqual([
      rejectedWith({
        _tag: 'conflict',
        kind: 'unworkable',
        detail: 'The thread tool of chat answered neither structured content nor text, so there is nothing to read',
      }),
      rejectedWith({ kind: 'unworkable', detail: 'The answer of the thread tool of chat holds nothing at /nothing' }),
      rejectedWith({
        kind: 'unworkable',
        detail: 'The thread tool of chat answered text that is not JSON, which holds nothing at /rows',
      }),
    ]);
  });

  it('is unworkable past what a run may record, deeper than a value may nest, or outside the output schema, saying a tool that may act may have', () => {
    const large = 'x'.repeat(1_048_576);

    expect([
      endedWith(documentOf(), answering({ content: [], structuredContent: large })),
      endedWith(documentOf(), answering({ content: [], structuredContent: nestedIn(513) }, 'acts')),
      endedWith(
        documentOf('/messages', { type: 'string' }),
        answering({ content: [], structuredContent: { messages } }),
      ),
    ]).toEqual([
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringMatching(
          /^What the thread tool of chat answered takes \d+ bytes as JSON with the record of the run, more than the 1048576 a run may record$/u,
        ),
      }),
      rejectedWith({
        kind: 'unworkable',
        detail: `What the thread tool of chat answered nests deeper than the 512 levels a value may${mayHaveActed}`,
      }),
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringMatching(
          /^What the thread tool of chat answered at \/messages does not match the output schema: the answer: /u,
        ),
      }),
    ]);
  });
});

describe('a call that was sent and did not answer', () => {
  it('is unworkable when the tool refused its arguments', () => {
    expect(endedWith(documentOf(), failing('arguments_refused', 'reads'))).toEqual(
      rejectedWith({ kind: 'unworkable', detail: 'The thread tool of chat refused the arguments: it stopped' }),
    );
  });

  it('is unfinished and safe to try again for a tool marked reads, and of an unknown effect for any other, keeping the wait a server asked for', () => {
    expect([
      endedWith(documentOf(), erring('reads')),
      endedWith(documentOf(), erring('unmarked')),
      endedWith(documentOf(), failing('server_failure', 'reads', 20_000)),
      endedWith(documentOf(), failing('timed_out', 'acts')),
    ]).toEqual([
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'tool_error',
        detail: 'The thread tool of chat answered an error: not allowed',
      }),
      rejectedWith({ _tag: 'conflict', kind: 'effect_unknown', because: 'tool_error' }),
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'server_failed',
        detail: 'The tool server chat failed: it stopped, after the run called the thread tool of chat',
        record: { retry_after_ms: 20_000 },
      }),
      rejectedWith({ _tag: 'conflict', kind: 'effect_unknown', because: 'server_failed' }),
    ]);
  });
});
