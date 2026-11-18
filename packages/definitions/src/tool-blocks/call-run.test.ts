import { compileJsonSchema } from '@on.auto/json-schema';
import { allPermissions, noAssetsHeld } from '@on.auto/operations';
import type { CalledOnce, OneCall, RunCall } from '@on.auto/tool-servers';
import { Effect, Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunContext } from '../capability/run-context.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';
import { onTheStandingClock } from '../testing/time/stepping-clock.ts';
import { CallBlockSchema, ToolUseSchema } from './call-block-schemas.ts';
import { type CallingDocument, type CallRunning, callRunOf, longestCallRunMs } from './call-run.ts';
import { callOutputInWords } from './call-words.ts';
import { isJsonPointer, textAt, valueAt } from './json-pointers.ts';
import { unrenderableFor, unworkable } from './render-refusals.ts';

const someWords: unknown = expect.any(String);

function wordsNaming(text: string): unknown {
  return expect.stringContaining(text);
}

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const journal = recordingJournal();

const context: RunContext = {
  id: runId,
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { id: '0199a3c4-7d2e-7c1a-9b3f-0000000000d1', name: 'thread-replies', version: 1 },
  journal,
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

const answered: CalledOnce = {
  kind: 'answered',
  mark: 'reads',
  detail: '',
  retryAfterMs: null,
  outcome: 'result',
  answer: { content: [], structuredContent: { messages: ['Shipped.'] } },
  answered: { is_error: false, result_bytes: 12, duration_ms: 3, jsonrpc_id: 1 },
};

const twiceTheChannel = 'In {{ input.channel }} and {{ input.channel }}';

const anything = Result.getOrThrow(compileJsonSchema({}, { what: 'output', nesting: 512 }));

const openInput = Result.getOrThrow(compileJsonSchema({ type: 'object' }, { what: 'input', nesting: 512 }));

function calling(written?: CallingDocument['call']['with']): CallingDocument {
  return {
    input: { schema: openInput },
    call: { server: 'chat', tool: 'thread', ...(written === undefined ? {} : { with: written }), read: '/messages' },
    output: { schema: anything },
  };
}

interface Sent {
  readonly call: OneCall;
  readonly runCall: RunCall | undefined;
}

const inAChannel: Schema.Json = { channel: 'C0123' };

const aDay: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u);

const aWait: unknown = expect.any(Number);

function ranWith(running: CallRunning, document: CallingDocument, input = inAChannel) {
  const sent: Sent[] = [];
  const run = callRunOf(
    {
      tools: {
        assets: noAssetsHeld,
        callOnce: (call, runCall) => {
          sent.push({ call, runCall });
          return Effect.succeed(answered);
        },
        mostRequestBytesTo: () => 1_048_576,
      },
    },
    running,
  );
  const ended = Effect.runPromiseExit(onTheStandingClock(run(document, input, context)));
  return { sent, ended };
}

const interaction = { noun: 'interaction function' };

const decodeCall = Schema.decodeUnknownResult(CallBlockSchema);

const decodeToolUse = Schema.decodeUnknownResult(ToolUseSchema);

const record = { server: 'chat', tool: 'thread_replies', read: '/messages' };

const answeredJsonPointers = {
  ok: true,
  channel: 'C0123',
  ts: '1699.1',
  'a/b': { 'm~n': 'escaped' },
  messages: [{ ts: '1699.2', user: 'ada', text: 'approve' }, { ts: 1_699_000_003 }, { ts: 1.5 }],
};

describe('a run of a call', () => {
  it('renders its arguments over its input and moment, calls the tool once on the run, and ends as the call ended', async () => {
    const { sent, ended } = ranWith(interaction, calling({ channel: '{{ input.channel }}', day: '{{ today }}' }));

    expect(await ended).toEqual(
      Exit.succeed({ output: ['Shipped.'], record: { server: 'chat', tool: 'thread', read: '/messages' } }),
    );
    expect(sent).toEqual([
      {
        call: {
          org: 'acme',
          playbook: 'alpha',
          reference: { server: 'chat', tool: 'thread' },
          input: { channel: 'C0123', day: aDay },
          meta: { 'auto.on/run_id': runId },
          longestRetryWaitMs: aWait,
        },
        runCall: { callId: runId, journal },
      },
    ]);
  });

  it('asks its call for the mark it requires, and sends without arguments when it writes none', async () => {
    const { sent, ended } = ranWith({ noun: 'lookup function', requiredMark: 'reads' }, calling());
    await ended;

    expect(sent.map(({ call }) => [call.input, call.requiredMark])).toEqual([[{}, 'reads']]);
  });

  it('may last the opening of its server four times and one call', () => {
    expect(longestCallRunMs).toBe(70_000);
  });
});

describe('a run of a call refused before it calls', () => {
  it('refuses an input its schema does not take, naming the noun of its function', async () => {
    const closed = Result.getOrThrow(compileJsonSchema({ type: 'string' }, { what: 'input', nesting: 512 }));
    const { sent, ended } = ranWith(interaction, { ...calling({}), input: { schema: closed } });

    expect(await ended).toEqual(Exit.fail(expect.objectContaining({ _tag: 'invalid_input', kind: 'input_schema' })));
    expect(sent).toEqual([]);
  });

  it('refuses an input an argument reads and it lacks, or a render a filter stops, as invalid', async () => {
    const lacking = ranWith(interaction, calling({ channel: '{{ input.thread }}' }));
    const stopped = ranWith(interaction, calling({ channel: '{{ input.channel | divided_by: 0 }}' }));

    expect([await lacking.ended, await stopped.ended]).toEqual([
      Exit.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: someWords,
          issues: [{ pointer: '/thread', detail: wordsNaming('Line 1:') }],
        }),
      ),
      Exit.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: someWords,
        }),
      ),
    ]);
    expect([...lacking.sent, ...stopped.sent]).toEqual([]);
  });

  it('is unworkable at the argument that renders a structure among text, or one past what a call may send, and at all of them past it together', async () => {
    const among = ranWith(interaction, calling({ channel: 'In {{ input.channel }}' }), { channel: ['C0123'] });
    const long = ranWith(interaction, calling({ channel: twiceTheChannel }), { channel: 'x'.repeat(524_300) });
    const large = ranWith(interaction, calling({ a: '{{ input.a }}', b: '{{ input.a }}' }), { a: 'x'.repeat(524_300) });

    expect([await among.ended, await long.ended, await large.ended]).toEqual([
      Exit.fail(expect.objectContaining({ kind: 'unworkable', record: { pointer: '/call/with/channel' } })),
      Exit.fail(expect.objectContaining({ kind: 'unworkable', record: { pointer: '/call/with/channel' } })),
      Exit.fail(
        expect.objectContaining({
          kind: 'unworkable',
          detail: someWords,
          record: { pointer: '/call/with' },
        }),
      ),
    ]);
  });
});

describe('a call block', () => {
  it('names a server and a tool, and may give arguments and a pointer to read', () => {
    const written = {
      server: 'chat',
      tool: 'thread',
      with: { limit: 100, channel: '{{ input.channel }}' },
      read: '/messages',
    };

    expect([decodeCall(written), decodeCall({ server: 'chat', tool: 'thread' })]).toEqual([
      Result.succeed(written),
      Result.succeed({ server: 'chat', tool: 'thread' }),
    ]);
  });

  it('refuses a block without its tool, or a pointer that is not text', () => {
    expect([
      Result.isFailure(decodeCall({ server: 'chat' })),
      Result.isFailure(decodeCall({ server: 'chat', tool: 'thread', read: 7 })),
    ]).toEqual([true, true]);
  });
});

describe('the use of a tool another block makes', () => {
  it('always gives the arguments it sends', () => {
    expect([
      Result.isSuccess(decodeToolUse({ server: 'chat', tool: 'post_message', with: {} })),
      Result.isFailure(decodeToolUse({ server: 'chat', tool: 'post_message' })),
    ]).toEqual([true, true]);
  });
});

describe('the words of what a call answered', () => {
  it('say what the tool answered, the records of a list in parentheses, or how many items there are', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({ user: `member-${index}`, text: 'x'.repeat(40) }));

    expect([
      callOutputInWords([{ user: 'member-17', text: 'Shipped the fix' }], record),
      callOutputInWords(many, record),
      callOutputInWords({ text: 'x'.repeat(400) }, record),
      callOutputInWords({}, { server: 'chat', tool: 'thread_replies' }),
    ]).toEqual([expect.stringContaining('“member-17”'), expect.any(String), expect.any(String), expect.any(String)]);
  });

  it('say nothing of a record that is not the record of a call', () => {
    expect([callOutputInWords({}, null), callOutputInWords({}, { delivered_at: '2026-10-07' })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('a JSON Pointer', () => {
  it('is empty, or a path from the root whose tildes escape a slash or a tilde', () => {
    expect(
      ['', '/ts', '/messages/0/ts', '/a~1b/m~0n', 'ts', '/ts~', '/ts~2'].map((text) => isJsonPointer(text)),
    ).toEqual([true, true, true, true, false, false, false]);
  });

  it('reads the value at its place, through objects and arrays, and nothing past them', () => {
    expect([
      valueAt(answeredJsonPointers, ''),
      valueAt(answeredJsonPointers, '/messages/0/user'),
      valueAt(answeredJsonPointers, '/a~1b/m~0n'),
      valueAt(answeredJsonPointers, '/messages/-'),
      valueAt(answeredJsonPointers, '/messages/01'),
      valueAt(answeredJsonPointers, '/messages/9'),
      valueAt(answeredJsonPointers, '/ts/length'),
      valueAt(answeredJsonPointers, '/toString'),
    ]).toEqual([answeredJsonPointers, 'ada', 'escaped', undefined, undefined, undefined, undefined, undefined]);
  });

  it('reads text, or a whole number as text, and nothing else', () => {
    expect([
      textAt(answeredJsonPointers, '/ts'),
      textAt(answeredJsonPointers, '/messages/1/ts'),
      textAt(answeredJsonPointers, '/messages/2/ts'),
      textAt(answeredJsonPointers, '/ok'),
      textAt(answeredJsonPointers, '/missing'),
    ]).toEqual(['1699.1', '1699000003', undefined, undefined, undefined]);
  });
});

describe('a template a run could not render', () => {
  it('is invalid for an input it lacks, at the pointer of that input, and at none for any other value', () => {
    expect([
      unrenderableFor('The message', { reason: 'missing_variable', variable: 'input.owner.name', line: 3 }),
      unrenderableFor('The message', { reason: 'missing_variable', variable: 'to', line: 2 }),
    ]).toMatchObject([
      {
        _tag: 'invalid_input',
        detail: someWords,
        issues: [{ pointer: '/owner/name', detail: wordsNaming('Line 3:') }],
      },
      { _tag: 'invalid_input', issues: [{ pointer: '' }] },
    ]);
  });

  it('is invalid where its render stopped, past a bound or at a filter', () => {
    expect(unrenderableFor('The message', { reason: 'limit_exceeded', limit: 'time', line: 4 })).toMatchObject({
      detail: 'The message cannot be rendered with this input',
      issues: [
        {
          pointer: '',
          detail: wordsNaming('Line 4:'),
        },
      ],
    });
  });
});

describe('a run that cannot work as written', () => {
  it('is a conflict of the kind unworkable, recording where in the document', () => {
    expect(unworkable('/to', 'The party renders to nothing')).toMatchObject({
      _tag: 'conflict',
      kind: 'unworkable',
      detail: 'The party renders to nothing',
      record: { pointer: '/to' },
    });
  });
});
