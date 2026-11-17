import { onTheStandingClock } from '@on.auto/definitions/testing';
import { noAssetsHeld } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { deniedText, patientTiming, threadReplies } from '@on.auto/tool-servers/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument, lookupRunId, lookupRuns, runsDocument } from '../testing/index.ts';
import { makeLookupFunctionAdapter } from './lookup-function.ts';

const anyWords: unknown = expect.any(String);

const aNumber: unknown = expect.any(Number);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const anyOutput = ['output:', '  schema: {}'];

const answeredInFull: unknown = expect.objectContaining({ is_error: false });

function reading(tool: string, written: readonly string[] = []): string {
  return lookupDocument({ tool, read: null, with: written, output: anyOutput });
}

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

describe('a run of a lookup function', () => {
  it('calls its tool once and ends at once with the value at read, recording the call on the run', async () => {
    const { fake, journal, run } = await lookupRuns();

    expect(await run(lookupDocument())).toEqual(
      Exit.succeed({ output: threadReplies, record: { server: 'chat', tool: 'thread', read: '/messages' } }),
    );
    expect(fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': lookupRunId },
      },
    ]);
    expect(journal.recorded()).toEqual([
      {
        type: 'tool_call_started',
        number: 1,
        data: {
          call_id: lookupRunId,
          server: 'chat',
          tool: 'thread',
          arguments_bytes: aNumber,
          arguments_sha256: aDigest,
          read_only: true,
        },
      },
      { type: 'tool_call_answered', number: 1, data: answeredInFull },
    ]);
  });

  it('checks what it read against its output schema', async () => {
    const { run } = await lookupRuns();

    expect(await run(lookupDocument({ output: ['output:', '  schema: { type: string }'] }))).toEqual(
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringMatching(
          /^What the thread tool of chat answered at \/messages does not match the output schema: /u,
        ),
      }),
    );
  });
});

describe('a run of a lookup function whose tool is no longer marked reads', () => {
  it('is unavailable, sends nothing and records no call, whether its server marks it acts now or leaves it unmarked', async () => {
    const { fake, journal, run } = await lookupRuns({ server: { hints: { thread: { readOnlyHint: false } } } });
    const acting = await run(lookupDocument());
    fake.annotateTool('thread', {});
    const unmarked = await run(lookupDocument());

    expect([acting, unmarked]).toEqual([
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tool_not_read_only',
        detail: anyWords,
      }),
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tool_not_read_only',
        detail: anyWords,
      }),
    ]);
    expect([fake.received(), journal.recorded()]).toEqual([[], []]);
  });
});

describe('a run of a lookup function that could not finish', () => {
  it('is unfinished and safe to try again, after a tool error, a server failure or a call past its bound', async () => {
    const { run } = await lookupRuns();
    const hurried = await lookupRuns({ timing: { ...patientTiming, callMs: 300 } });

    expect([
      await run(reading('denied')),
      await run(reading('broken')),
      await hurried.run(reading('sleep', ['    ms: 5000'])),
    ]).toEqual([
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'tool_error',
        detail: `The denied tool of chat answered an error: ${deniedText}`,
      }),
      rejectedWith({ _tag: 'unavailable', kind: 'tools_unfinished', because: 'server_failed' }),
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'server_failed',
        detail: expect.stringContaining('did not answer within 300 ms'),
      }),
    ]);
  });

  it('is unavailable, sending nothing, when its server does not serve the playbook or cannot be reached', async () => {
    const elsewhere = await lookupRuns({ entry: { org: 'globex' } });
    const { fake, run } = await lookupRuns();
    await fake.close();

    expect([await elsewhere.run(lookupDocument()), await run(lookupDocument())]).toEqual([
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_server_not_configured' }),
      rejectedWith({ kind: 'tool_server_failed', because: 'unreachable' }),
    ]);
  });
});

const lookup = makeLookupFunctionAdapter({
  tools: {
    assets: noAssetsHeld,
    listServers: () => Effect.succeed([]),
    callOnce: () => Effect.die(new Error('No call is made here')),
    mostRequestBytes: 16_777_216,
    mostRequestBytesTo: () => 16_777_216,
  },
  runs: { readRecorded: () => Effect.die(new Error('No run is read here')), content: memoryLedger().service.content },
});

function prepared(source: string) {
  return Effect.runSync(onTheStandingClock(lookup.prepare(source)));
}

function refusalOf(source: string) {
  return Effect.runSync(Effect.exit(onTheStandingClock(lookup.prepare(source))));
}

const anObjectSchema: unknown = expect.objectContaining({ type: 'object' });

const anArraySchema: unknown = expect.objectContaining({ type: 'array' });

const theRunsAnswer: unknown = expect.objectContaining({ type: 'object', required: ['runs', 'more'] });

const plain = ['---', 'call:', '  server: chat', '  tool: thread', 'output:', '  schema: {}', '---', ''].join('\n');

describe('the lookup capability', () => {
  it('is the lookup function type, guided by its format, reaching outside and changing nothing there', () => {
    expect([
      lookup.type,
      lookup.title,
      lookup.guide,
      lookup.noun,
      lookup.mediaType,
      lookup.reachesOutside,
      lookup.mayChangeOutside,
      lookup.longestAnyRunMs,
      lookup.resumes,
    ]).toEqual([
      'lookup',
      'Lookup',
      {
        name: 'lookup-function',
        variables: {
          'lookup.most_call_arguments': { value: '16 MiB', default: '16 MiB' },
          'lookup.bounds_changed_by': {
            value: 'can be changed only by whoever runs the server',
            default: 'can be changed only by whoever runs the server',
          },
        },
      },
      { one: 'lookup function', other: 'lookup functions' },
      'text/markdown',
      true,
      false,
      70_000,
      false,
    ]);
  });

  it('prepares a definition that calls tools, finishes within its call, lets a call in flight end, and runs at most 70 seconds', () => {
    const definition = prepared(lookupDocument());

    expect([
      definition.callsTools,
      definition.finishesLaterFor({}),
      definition.whenCancelled,
      definition.longestRunMs,
    ]).toEqual([true, false, 'finish', 70_000]);
  });
});

describe('a lookup function that reads runs', () => {
  it('calls no tool, and is saved without asking any server', () => {
    const definition = prepared(runsDocument());

    expect([
      definition.callsTools,
      Effect.runSync(Effect.exit(definition.check({ org: 'acme', playbook: 'alpha' }))),
    ]).toEqual([false, Exit.succeed({})]);
  });

  it('is summed up with its fixed answer and the definition whose runs it reads', () => {
    expect(prepared(runsDocument()).summary).toEqual({
      description: 'Reads the paces computed for one campaign since a day, newest first',
      inputSchema: anObjectSchema,
      outputSchema: theRunsAnswer,
      details: { reads: [{ type: 'computation', name: 'campaign-pace' }] },
    });
  });

  it('says how many runs it examined and answered with, and whether it left older ones unread', () => {
    expect([
      lookup.describeOutput({ runs: [{}, {}], more: false }, { examined: 5, through: '2026-10-01T09:00:00.000Z' }),
      lookup.describeOutput({ runs: [{}], more: true }, { examined: 1, through: '2026-10-01T09:00:00.000Z' }),
    ]).toEqual([
      'It examined 5 runs that succeeded and answered with 2.',
      'It examined 1 run that succeeded and answered with 1; older runs are left unread.',
    ]);
  });
});

describe('the summary of a lookup function', () => {
  it('holds its description, its schemas and the tool it reads through', () => {
    expect(prepared(lookupDocument()).summary).toEqual({
      description: 'Read the replies of a thread in the team chat, oldest first',
      inputSchema: anObjectSchema,
      outputSchema: anArraySchema,
      details: { call: { server: 'chat', tool: 'thread' } },
    });
  });

  it('holds no description or input schema when it has neither', () => {
    expect(Object.keys(prepared(plain).summary)).toEqual(['outputSchema', 'details']);
  });
});

describe('what the lookup capability says', () => {
  it('refuses a document with its problems, each at its line', () => {
    expect([
      refusalOf(lookupDocument({ output: [] })),
      refusalOf(lookupDocument({ output: [], server: 'Chat' })),
    ]).toEqual([
      Exit.fail(
        expect.objectContaining({ _tag: 'invalid_input', detail: 'The lookup function definition has a problem' }),
      ),
      Exit.fail(expect.objectContaining({ detail: 'The lookup function definition has 2 problems' })),
    ]);
  });

  it('says what the tool answered, or the answer alone where no call is recorded', () => {
    const record = { server: 'chat', tool: 'thread', read: '/messages' };

    expect([lookup.describeOutput(['Shipped the fix'], record), lookup.describeOutput('Shipped the fix')]).toEqual([
      'It asked the thread tool of chat; its answer: “Shipped the fix”.',
      'Its answer: “Shipped the fix”.',
    ]);
  });
});
