import { compileJsonSchema } from '@on.auto/json-schema';
import { allPermissions } from '@on.auto/operations';
import type { CalledOnce, OneCall, RunCall } from '@on.auto/tool-servers';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunContext } from '../capability/run-context.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';
import { onTheStandingClock } from '../testing/time/stepping-clock.ts';
import { callRunOf, longestCallRunMs, type CallingDocument, type CallRunning } from './call-run.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const journal = recordingJournal();

const context: RunContext = {
  id: runId,
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'thread-replies', version: 1 },
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
        callOnce: (call, runCall) => {
          sent.push({ call, runCall });
          return Effect.succeed(answered);
        },
      },
    },
    running,
  );
  const ended = Effect.runPromiseExit(onTheStandingClock(run(document, input, context)));
  return { sent, ended };
}

const interaction = { noun: 'interaction function' };

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
          detail: 'The definition reads input.thread on line 1, which the input does not have',
          issues: [{ pointer: '/thread', detail: 'Line 1: it reads input.thread, which this input does not have' }],
        }),
      ),
      Exit.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: 'The argument channel of the call cannot be rendered with this input',
        }),
      ),
    ]);
    expect([...lacking.sent, ...stopped.sent]).toEqual([]);
  });

  it('is unworkable at the argument that renders a structure among text, or one past what a call may send, and at all of them past it together', async () => {
    const among = ranWith(interaction, calling({ channel: 'In {{ input.channel }}' }), { channel: ['C0123'] });
    const long = ranWith(interaction, calling({ channel: twiceTheChannel }), { channel: 'x'.repeat(131_100) });
    const large = ranWith(interaction, calling({ a: '{{ input.a }}', b: '{{ input.a }}' }), { a: 'x'.repeat(131_100) });

    expect([await among.ended, await long.ended, await large.ended]).toEqual([
      Exit.fail(expect.objectContaining({ kind: 'unworkable', record: { pointer: '/call/with/channel' } })),
      Exit.fail(expect.objectContaining({ kind: 'unworkable', record: { pointer: '/call/with/channel' } })),
      Exit.fail(
        expect.objectContaining({
          kind: 'unworkable',
          detail:
            'The arguments of the call take 262215 bytes, more than the 262144 a call may send; give the function a smaller input',
          record: { pointer: '/call/with' },
        }),
      ),
    ]);
  });
});
