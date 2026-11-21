import type { RecordedCall } from '@on.auto/definitions';
import { cancelledByAnother, recordingJournal } from '@on.auto/definitions/testing';
import type { FakeTool } from '@on.auto/tool-servers/served-fakes';
import { fakeMcpInProcess, reportingAccess } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Exit, Schema, Struct } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { RateLimited } from '../failure/rate-limited.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { describingGateway } from '../provider-testing/answers-in-turn.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { noLongerOffered } from '../steps/asked-calls.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import {
  firstAttempt,
  moment,
  type Reasoning,
  reasoningAdapter,
  reasoningOf,
  runContextWith,
} from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  graphKey,
  recordedBy,
  stopping,
  upToTheFirst,
  withGraphTools,
  withoutTools,
} from '../testing/resumed-attempts.ts';
import { answers, scriptedLanguageModel, type ScriptedReply } from '../testing/scripted-language-model.ts';
import { readToolsNoticeOf } from '../tools/read-tools-notice.ts';
import type { ModelReading } from './run-bounds.ts';

const anyWords: unknown = expect.any(String);

const limited: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: 2000 }),
  );

const echoing = answers(toolCallsResult([['graph__echo', { said: 'acme' }]]));

async function afterAnInterruptedEnd(laterEntry: Parameters<typeof graphAccessTo>[1] = {}) {
  const fake = aGraph();
  const tools = graphAccessTo(fake.url);
  const { calls, first } = await recordedBy(withGraphTools, { tools }, echoing, answers(textResult('Echoed.')));
  const cut = upToTheFirst(calls, 'tool_call_started');
  const ending = reasoningOf({ tools, attempt: attemptOf(cut), content: first.content });
  const ended = await ending.running(withGraphTools);
  const sentBefore = fake.received().length;
  const again = reasoningOf({
    tools: graphAccessTo(fake.url, laterEntry),
    attempt: attemptOf([...cut, ...ending.journal.calls()]),
    content: first.content,
  });
  return {
    ended,
    again: await again.running(withGraphTools),
    interruptedEnds: ending.journal.calls().map(({ type }) => type),
    sentAgain: fake.received().length - sentBefore,
    modelCalls: again.requests(),
  };
}

const theOutcomeUnknown: unknown = Exit.fail(
  expect.objectContaining({ kind: 'effect_unknown', because: 'call_outcome_unknown' }),
);

const withoutStructuredOutputs = {
  MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal.example/v1' }]),
};

const deciding = documentOf(
  [
    'model: internal/llama-3.3-70b',
    'output:',
    '  format: json',
    '  schema: {type: object, properties: {verdict: {type: string}}, required: [verdict], additionalProperties: false}',
  ].join('\n'),
);

const usageOfBoth = {
  input: { total: 38, uncached: 32, cache_read: 6, cache_write: null },
  output: { total: 20, text: 20, reasoning: 0 },
  total: 58,
};

async function runAnswered(texts: readonly string[], reading?: ModelReading) {
  const recording = recordingFetch((_request, attempt) => jsonResponse(chatCompletion(texts[attempt - 1] ?? '')));
  const { languageModel } = await accessFor(withoutStructuredOutputs, { fetch: recording.fetch });
  const capability = reasoningAdapter({
    languageModel,
    offered: { providers: ['internal'], aliases: [] },
    ...(reading === undefined ? {} : { reading }),
  });
  const journal = recordingJournal();
  const prepared = Effect.runSync(capability.prepare(deciding));
  const exit = await Effect.runPromiseExit(prepared.run({ text: 'the renewal' }, runContextWith(journal)));
  return { exit, facts: journal.recorded(), requests: recording.requests() };
}

function answeredThenDown(_request: unknown, attempt: number): Response {
  return attempt === 1
    ? jsonResponse(chatCompletion('{"verdict":true}'), 200, { 'x-call-cost': '0.25' })
    : jsonResponse({ error: { message: 'down' } }, 500);
}

const notes = `# Notes\n\n${'Ship on Friday. '.repeat(64)}`;

const readsAFile: FakeTool = {
  name: 'read_file',
  description: 'Reads a file, answering a line about it and the file as an embedded resource.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { readOnlyHint: true },
  answer: () => ({
    content: [
      { type: 'text', text: 'Read notes.md at 3f2a1c.' },
      { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: notes } },
    ],
  }),
};

const counted = {
  input: { total: 100, uncached: 100, cache_read: null, cache_write: null },
  output: { total: 0, text: 0, reasoning: null },
  total: 100,
};

const asking = answers(toolCallsResult([['graph__read_file', {}]], { usage: counted, request_bytes: 1000 }));

const answering = answers(textResult('Ship on Friday.'));

const aSmallWindow: Reasoning['reading'] = {
  defaultInputTokens: 2_000_000,
  mostInputTokens: 2_000_000,
  contextWindowOf: () => Effect.succeed(160),
};

const shownInFormatOne = 'Read notes.md at 3f2a1c.\n[resource content, not shown]';

function toolsWithFiles() {
  const fake = fakeMcpInProcess({ bearer: graphKey, tools: [readsAFile] });
  onTestFinished(() => fake.close());
  const reporting = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: graphKey } },
  );
  onTestFinished(() => reporting.access.close());
  return reporting;
}

const isToolResult = Schema.is(
  Schema.Struct({ type: Schema.Literal('tool-result'), output: Schema.Struct({ value: Schema.String }) }),
);

const isMessageOfParts = Schema.is(Schema.Struct({ content: Schema.Array(Schema.Unknown) }));

function toolTextsIn(request: ModelRequest | undefined): readonly string[] {
  return (request?.conversation ?? []).flatMap((message) =>
    isMessageOfParts(message) ? message.content.flatMap((part) => (isToolResult(part) ? [part.output.value] : [])) : [],
  );
}

function answeredIn(calls: readonly RecordedCall[]) {
  return calls.flatMap((call) => (call.type === 'tool_call_answered' ? [call.data] : []));
}

function recordedBefore(calls: readonly RecordedCall[], shownBytes?: number): readonly RecordedCall[] {
  return calls.map((call) => {
    if (call.type !== 'tool_call_answered') {
      return call;
    }
    const data = Struct.omit(call.data, ['shown_format', 'shown_bytes']);
    return { ...call, data: shownBytes === undefined ? data : { ...data, shown_bytes: shownBytes } };
  });
}

async function firstAttemptResumedEmbeddedResources(given: Pick<Reasoning, 'reading'>) {
  const { access: tools, content } = toolsWithFiles();
  const first = reasoningOf({ tools, content, ...given }, asking, answering);
  await first.running(withGraphTools);
  const calls = upToTheFirst(first.journal.calls(), 'tool_call_answered');
  const goOn = async (recorded: readonly RecordedCall[]) => {
    const again = reasoningOf({ tools, content, ...given, attempt: attemptOf(recorded) }, answering);
    await again.running(withGraphTools);
    return again.requests();
  };
  return { first, calls, goOn };
}

const naming = (tools: string) => documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [${tools}]`, 'Judge it.');

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/judge', run: 1 };

async function recordOf(source: string, given: { readonly calledBy?: Readonly<typeof calledBy> } = {}) {
  const fake = aGraph();
  const { languageModel } = scriptedLanguageModel(
    answers(toolCallsResult([['graph__profile', {}]])),
    answers(textResult('Record 7 is open, so it stays.')),
  );
  const capability = reasoningAdapter({ languageModel, tools: graphAccessTo(fake.url) });
  const context = { ...runContextWith(recordingJournal()), ...given };
  const exit = await Effect.runPromiseExit(
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
      Effect.andThen(Effect.flatMap(capability.prepare(source), (prepared) => prepared.run({}, context))),
      Effect.provide(TestClock.layer()),
    ),
  );
  return Exit.match(exit, {
    onFailure: () => ({}),
    onSuccess: (answer): Schema.JsonObject => answer.record,
  });
}

const usage = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

const askingReadToolsRuns = answers(
  toolCallsResult([['graph__search', { query: 'acme' }]], { usage, duration_ms: 400 }),
);

const record = { usage, duration_ms: 400 };

describe('a run that goes on after a call of a tool that may change something was never answered', () => {
  it('is a conflict whose effect is unknown, because the outcome of that call is not known', async () => {
    const tools = graphAccessTo(aGraph().url);
    const { calls, first } = await recordedBy(withGraphTools, { tools }, echoing, answers(textResult('Echoed.')));
    const again = reasoningOf({
      tools,
      attempt: attemptOf(upToTheFirst(calls, 'tool_call_started')),
      content: first.content,
    });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          kind: 'effect_unknown',
          because: 'call_outcome_unknown',
          detail: anyWords,
        }),
      ),
    );
  });
});

describe('a run that goes on after an attempt ended such a call as interrupted and stopped before the run ended', () => {
  it('is the same conflict, sending the call no second time', async () => {
    const ran = await afterAnInterruptedEnd();

    expect([ran.again, ran.ended]).toEqual([ran.ended, theOutcomeUnknown]);
    expect([ran.interruptedEnds, ran.sentAgain, ran.modelCalls]).toEqual([['tool_call_failed'], 0, []]);
  });

  it('is the same conflict when the run no longer offers the tool, calling neither the model nor a tool', async () => {
    const ran = await afterAnInterruptedEnd({ allowed: ['search'] });

    expect([ran.again, ran.ended]).toEqual([ran.ended, theOutcomeUnknown]);
    expect([ran.interruptedEnds, ran.sentAgain, ran.modelCalls]).toEqual([['tool_call_failed'], 0, []]);
  });

  it('sends a call of a tool marked reads again, and goes on to its answer', async () => {
    const fake = aGraph();
    const tools = graphAccessTo(fake.url);
    const searching = answers(toolCallsResult([['graph__search', { query: 'acme' }]]));
    const { calls, first } = await recordedBy(withGraphTools, { tools }, searching, answers(textResult('Found.')));
    const cut = upToTheFirst(calls, 'tool_call_started');
    const stopped = reasoningOf({ tools, attempt: attemptOf(cut), content: first.content, cancelledAfter: 1 });
    await stopped.running(withGraphTools);
    const sentBefore = fake.received().length;
    const again = reasoningOf(
      { tools, attempt: attemptOf([...cut, ...stopped.journal.calls()]), content: first.content },
      answers(textResult('Found.')),
    );

    expect(await again.running(withGraphTools)).toEqual(Exit.succeed(expect.objectContaining({ output: 'Found.' })));
    expect([stopped.journal.calls().map(({ type }) => type), fake.received().length - sentBefore]).toEqual([
      ['tool_call_failed'],
      1,
    ]);
  });
});

describe('a run that goes on after its server stopped offering a tool the model asked for', () => {
  it('tells the model the tool is no longer offered and goes on to its answer, sending nothing', async () => {
    const fake = aGraph();
    const { calls, first } = await recordedBy(
      withGraphTools,
      { tools: graphAccessTo(fake.url) },
      echoing,
      answers(textResult('Echoed.')),
    );
    const again = reasoningOf(
      {
        tools: graphAccessTo(fake.url, { allowed: ['search'] }),
        attempt: attemptOf(upToTheFirst(calls, 'model_call_answered')),
        content: first.content,
      },
      answers(textResult('Searched instead.')),
    );

    expect(await again.running(withGraphTools)).toMatchObject({
      _tag: 'Success',
      value: { output: 'Searched instead.' },
    });
    expect(JSON.stringify(again.requests()[0]?.conversation)).toContain(noLongerOffered('graph__echo'));
    expect(fake.received().filter(({ tool }) => tool === 'echo')).toHaveLength(1);
  });
});

describe('a run that ended without a final result, asked for again under its id', () => {
  it('runs again, numbering its model calls after those of the attempt before', async () => {
    const { calls } = await recordedBy(withoutTools, {}, limited);
    const again = reasoningOf(
      { attempt: { ...firstAttempt, modelCallsBefore: 1 } },
      answers(textResult('Profits rose.')),
    );

    expect(await again.running(withoutTools)).toMatchObject({ _tag: 'Success', value: { output: 'Profits rose.' } });
    expect([calls.length, again.journal.recorded()]).toMatchObject([
      2,
      [
        { type: 'model_call_started', number: 2 },
        { type: 'model_call_answered', number: 2 },
      ],
    ]);
  });
});

describe('a run cut off in two attempts, performed a third time', () => {
  it('numbers each model call it makes again after those of the attempts before it', async () => {
    const { calls, first } = await recordedBy(withoutTools, {}, stopping);
    const second = reasoningOf({ attempt: attemptOf(calls), content: first.content }, stopping);
    await second.running(withoutTools);
    const third = reasoningOf(
      { attempt: attemptOf([...calls, ...second.journal.calls()]), content: first.content },
      answers(textResult('Profits rose.')),
    );

    expect(await third.running(withoutTools)).toMatchObject({ _tag: 'Success', value: { output: 'Profits rose.' } });
    expect(
      [second, third].map(({ journal }) => journal.recorded().map(({ type, number }) => `${type} ${number}`)),
    ).toEqual([
      ['model_call_failed 1', 'model_call_started 2'],
      ['model_call_failed 2', 'model_call_started 3', 'model_call_answered 3'],
    ]);
  });
});

describe('a run that goes on from a model call that failed', () => {
  it('ends with the rejection the attempt that recorded the failure ended with, making no call', async () => {
    const { calls, ran, first } = await recordedBy(withoutTools, {}, limited);
    const again = reasoningOf({ attempt: attemptOf(calls), content: first.content });

    expect(await again.running(withoutTools)).toEqual(ran);
    expect(again.requests()).toEqual([]);
  });
});

describe('a run whose model answers JSON that misses its schema, and then JSON that meets it', () => {
  it('answers the corrected JSON, recording one model call, answered with the correction and the usage of both requests', async () => {
    const { exit, facts } = await runAnswered(['{"verdict":true}', '{"verdict":"approve"}']);

    expect(exit).toMatchObject(Exit.succeed({ output: { verdict: 'approve' }, record: { usage: usageOfBoth } }));
    expect(facts.map(({ type }) => type)).toEqual(['model_call_started', 'model_call_answered']);
    expect(facts[1]?.data).toMatchObject({
      usage: usageOfBoth,
      output_mode: 'described',
      repair: { outcome: 'repaired', issues: [{ pointer: '/verdict', detail: 'Expected string' }] },
    });
  });
});

describe('a run with too few input tokens left to ask its model again', () => {
  it('is refused with the issues of the answer, saying no correction was attempted, and records why', async () => {
    const reading = { defaultInputTokens: 30, mostInputTokens: 30, contextWindowOf: () => Effect.undefined };

    const { exit, facts, requests } = await runAnswered(['{"verdict":true}', '{"verdict":"approve"}'], reading);

    expect(requests).toHaveLength(1);
    expect(exit).toMatchObject(
      Exit.fail({
        _tag: 'unavailable',
        detail: anyWords,
      }),
    );
    expect(facts.find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      repair: { outcome: 'skipped', because: 'input_tokens' },
    });
  });
});

describe('a run whose model is asked once more for JSON that missed its schema, by a request that fails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is refused with the issues of the answer, saying the request failed, and records the cost of the answer', async () => {
    const recording = recordingFetch(answeredThenDown);
    const { languageModel } = await accessFor(describingGateway, { fetch: recording.fetch });
    const capability = reasoningAdapter({ languageModel, offered: { providers: ['internal'], aliases: [] } });
    const journal = recordingJournal();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const running = Effect.runPromiseExit(
      Effect.runSync(capability.prepare(deciding)).run({ text: 'the renewal' }, runContextWith(journal)),
    );
    await vi.advanceTimersByTimeAsync(6_000);
    const exit = await running;

    expect(exit).toMatchObject(
      Exit.fail({
        _tag: 'unavailable',
        detail: anyWords,
      }),
    );
    expect(journal.recorded().find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      cost_usd: 0.25,
      repair: { outcome: 'failed', because: 'provider_unavailable' },
    });
  });
});

describe('a run that goes on from a tool call whose answer carried a file', () => {
  it('shows the model the file again exactly as its first attempt did, read whole', async () => {
    const { first, calls, goOn } = await firstAttemptResumedEmbeddedResources({});
    const [answered] = answeredIn(calls);

    const requests = await goOn(calls);

    expect([answered?.shown_format, answered?.shown_bytes]).toEqual([2, undefined]);
    expect(toolTextsIn(first.requests()[1])).toEqual([`Read notes.md at 3f2a1c.\n${notes}`]);
    expect(requests).toEqual([first.requests()[1]]);
  });

  it('shows the model the file again exactly as its first attempt did, cut where its call recorded the cut', async () => {
    const { first, calls, goOn } = await firstAttemptResumedEmbeddedResources({ reading: aSmallWindow });
    const [answered] = answeredIn(calls);
    const [shown] = toolTextsIn(first.requests()[1]);

    const requests = await goOn(calls);

    expect([answered?.shown_format, typeof answered?.shown_bytes]).toEqual([2, 'number']);
    expect(shown?.startsWith('Read notes.md at 3f2a1c.\n# Notes')).toBe(true);
    expect(shown).toContain(`[The answer was cut to ${String(answered?.shown_bytes)} of its`);
    expect(requests).toEqual([first.requests()[1]]);
  });

  it('shows the model the text of format 1 for a call recorded before calls named their format, whole or cut', async () => {
    const { calls, goOn } = await firstAttemptResumedEmbeddedResources({});

    const whole = await goOn(recordedBefore(calls));
    const cut = await goOn(recordedBefore(calls, 10));

    expect([toolTextsIn(whole[0]), toolTextsIn(cut[0])]).toEqual([
      [shownInFormatOne],
      [
        'Read notes\n[The answer was cut to 10 of its 54 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest.]',
      ],
    ]);
  });
});

describe('the record of a run the agent asked for, of a reasoning function whose tools are all marked reads', () => {
  it('carries the notice its save gives, from the marks the run already holds', async () => {
    const kept = await recordOf(naming('graph/profile'));

    expect(kept).toMatchObject({ notices: [readToolsNoticeOf([{ server: 'graph', tool: 'profile' }])] });
  });

  it('carries none for a run a workflow started, or where a tool it names may act', async () => {
    const records = [
      await recordOf(naming('graph/profile'), { calledBy }),
      await recordOf(naming('graph/profile, graph/echo')),
    ];

    expect(records.map((kept) => 'notices' in kept)).toEqual([false, false]);
    expect(records.map((kept) => 'model' in kept)).toEqual([true, true]);
  });

  it('carries none for a function that names no tools', async () => {
    const { languageModel } = scriptedLanguageModel(answers(textResult('It stays.')));
    const capability = reasoningAdapter({ languageModel });
    const answer = await Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
        Effect.andThen(
          Effect.flatMap(
            capability.prepare(documentOf('model: anthropic/claude-sonnet-4-5', 'Judge it.')),
            (prepared) => prepared.run({}, runContextWith(recordingJournal())),
          ),
        ),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(JSON.stringify(answer)).not.toContain('notices');
  });
});

describe('a run whose cancel another server recorded once its model asked for a tool', () => {
  it('starts no call after it and ends cancelled as asked, with the spending of its model call', async () => {
    const graph = aGraph();
    const run = reasoningOf({ tools: graphAccessTo(graph.url), cancelledAfter: 2 }, askingReadToolsRuns);

    expect(await run.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'cancelled', detail: cancelledByAnother.detail, kind: 'requested', record }),
      ),
    );
    expect([run.requests().length, graph.received()]).toEqual([1, []]);
  });
});

describe('a run whose cancel another server recorded once its tool answered', () => {
  it('makes no second model call and ends cancelled, the tool called once', async () => {
    const graph = aGraph();
    const run = reasoningOf(
      { tools: graphAccessTo(graph.url), cancelledAfter: 4 },
      askingReadToolsRuns,
      answers(textResult('Never asked.')),
    );

    expect(await run.running(withGraphTools)).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'cancelled', kind: 'requested', record })),
    );
    expect([run.requests().length, graph.received().length]).toEqual([1, 1]);
    expect(run.journal.recorded().map(({ type }) => type)).toEqual([
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
      'tool_call_answered',
    ]);
  });
});

describe('a run cancelled in its process while a call of it is in flight', () => {
  it('ends that call as interrupted, a tool call or the model call, with the spending of its model calls so far', async () => {
    const graph = aGraph();
    const first = reasoningOf({ tools: graphAccessTo(graph.url) }, askingReadToolsRuns, stopping);
    await first.running(withGraphTools);
    const calls = first.journal.calls();
    const prepared = Effect.runSync(first.capability.prepare(withGraphTools));

    expect(prepared.cancelledAttempt(attemptOf(upToTheFirst(calls, 'tool_call_started')))).toMatchObject({
      ends: [{ type: 'tool_call_failed', data: { number: 1, because: 'interrupted', jsonrpc_id: null } }],
      record,
    });
    expect(prepared.cancelledAttempt(attemptOf(calls))).toMatchObject({
      ends: [{ type: 'model_call_failed', data: { number: 2, because: 'interrupted', provider: 'scripted' } }],
      record,
    });
  });
});
