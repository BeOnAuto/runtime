import { setTimeout } from 'node:timers/promises';

import { recordingJournal, shapeNamed } from '@on.auto/definitions/testing';
import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { type FakeMcpServer, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { noToolServers, reportingAccess } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Exit, Fiber, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf, reasoningExample } from '../testing/definition-documents.ts';
import { answers, jsonResult, type ScriptedReply, textResult } from '../testing/index.ts';
import { toolCallsResult } from '../testing/model-results.ts';
import { moment, reasoningAdapter, reasoningOf, reasoningWith, runContextWith } from '../testing/reasoning-runs.ts';

const anyText: unknown = expect.any(String);

const summarizing = documentOf(
  [
    'model: anthropic/claude-sonnet-4-5',
    'config: {max_output_tokens: 300, temperature: 0.1, stop_sequences: [END]}',
    'input:',
    '  default: {tone: plain}',
    'provider_options:',
    '  anthropic: {thinking: {type: enabled, budgetTokens: 1024}}',
  ].join('\n'),
  '{% system %}Write in a {{ input.tone }} tone.{% endsystem %}Summarize {{ input.text }} ({{ today }}, {{ now }}).',
);

const answered = textResult('A short summary.', {
  model: {
    requested: 'anthropic/claude-sonnet-4-5',
    resolved: 'anthropic/claude-sonnet-4-5',
    answered: 'claude-sonnet-4-5-20250929',
  },
  raw_finish_reason: 'end_turn',
  usage: {
    input: { total: 40, uncached: 40, cache_read: 0, cache_write: 0 },
    output: { total: 5, text: 5, reasoning: 0 },
    total: 45,
  },
  response_id: 'msg_01',
  warnings: [{ type: 'unsupported', feature: 'seed', detail: null }],
  duration_ms: 812,
});

const answeredRecord = {
  model: {
    requested: 'anthropic/claude-sonnet-4-5',
    resolved: 'anthropic/claude-sonnet-4-5',
    answered: 'claude-sonnet-4-5-20250929',
  },
  settings: { max_output_tokens: 300, temperature: 0.1, stop_sequences: ['END'] },
  output_format: 'text',
  finish_reason: 'stop',
  raw_finish_reason: 'end_turn',
  usage: {
    input: { total: 40, uncached: 40, cache_read: 0, cache_write: 0 },
    output: { total: 5, text: 5, reasoning: 0 },
    total: 45,
  },
  response_id: 'msg_01',
  warnings: [{ type: 'unsupported', feature: 'seed', detail: null }],
  duration_ms: 812,
  prompt: {
    instructions: 'Write in a warm tone.',
    message: 'Summarize the quarter (2026-10-01, 2026-10-01T09:30:00.000Z).',
    truncated: false,
  },
};

const sonnet = 'model: anthropic/claude-sonnet-4-5';

const page = keptForATest('019a5b12-0000-7000-8000-000000000021', 'text/markdown', '# Prices\n\nThey went up.');

const rows = keptForATest('019a5b12-0000-7000-8000-000000000022', 'application/json', '{"rows":[{"city":"Lyon"}]}');

const photo = keptForATest('019a5b12-0000-7000-8000-000000000023', 'image/png', new Uint8Array([137, 80, 78, 71]));

const theirs = keptForATest('019a5b12-0000-7000-8000-000000000024', 'text/plain', 'theirs', {
  org: 'acme',
  playbook: 'beta',
});

const full = keptForATest('019a5b12-0000-7000-8000-000000000025', 'text/plain', 'x'.repeat(200_000));

const long = keptForATest('019a5b12-0000-7000-8000-000000000026', 'text/plain', 'x'.repeat(200_001));

function reasoningOver(...replies: readonly ScriptedReply[]) {
  const holding = heldForATest([page, rows, photo, theirs, full, long]);
  return { holding, ...reasoningOf({ tools: { ...noToolServers, assets: holding } }, ...replies) };
}

function refusedAt(pointer: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'invalid_input', issues: [{ pointer, detail: anyText }] }));
}

async function messagesOf(body: string, input: Schema.Json) {
  const { running, requests } = reasoningOver(answers(textResult('Noted.')));
  const ran = await running(documentOf(sonnet, body), input);
  return { ran, messages: requests()[0]?.messages };
}

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

async function runAnswered(text: string) {
  const recording = recordingFetch(() => jsonResponse(chatCompletion(text)));
  const { languageModel } = await accessFor(withoutStructuredOutputs, { fetch: recording.fetch });
  const capability = reasoningAdapter({ languageModel, offered: { providers: ['internal'], aliases: [] } });
  const journal = recordingJournal();
  const preparedDescribedRuns = Effect.runSync(capability.prepare(deciding));
  const exit = await Effect.runPromiseExit(preparedDescribedRuns.run({ text: 'the renewal' }, runContextWith(journal)));
  return { exit, facts: journal.recorded() };
}

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

async function sleepingGraph(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey, hints: { sleep: { idempotentHint: true } } });
  closing.push(fake.close);
  return fake;
}

async function calledOnce(fake: FakeMcpServer): Promise<void> {
  if (fake.received().length > 0) {
    return;
  }
  await setTimeout(5);
  await calledOnce(fake);
}

const source = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/sleep]', 'Wait for acme.');

const pastTheBound = '11 minutes';

const counted = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

const { prepared } = reasoningWith();

describe('running a reasoning function definition', () => {
  it('sends the rendered instructions and message with the settings, the provider options, a timeout and the input tokens left in the run', async () => {
    const { running, requests } = reasoningWith(answers(answered));
    await running(summarizing, { text: 'the quarter' });

    expect(requests()).toEqual([
      {
        model: 'anthropic/claude-sonnet-4-5',
        instructions: 'Write in a plain tone.',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Summarize the quarter (2026-10-01, 2026-10-01T09:30:00.000Z).' }],
          },
        ],
        output: { type: 'text' },
        settings: { max_output_tokens: 300, temperature: 0.1, stop_sequences: ['END'] },
        provider_options: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
        timeout_ms: 67_500,
        run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        room: { input_tokens: 2_000_000 },
      },
    ]);
  });

  it('answers with the text and records what happened', async () => {
    const { running } = reasoningWith(answers(answered));

    expect(await running(summarizing, { text: 'the quarter', tone: 'warm' })).toEqual(
      Exit.succeed({ output: 'A short summary.', record: answeredRecord }),
    );
  });
});

describe('the output of a run', () => {
  it('is the JSON value for a JSON definition, which sends its schema', async () => {
    const { running, requests } = reasoningWith(answers(jsonResult({ summary: 'Globex grew.' })));

    expect(await running(reasoningExample, { account: 'Globex' })).toMatchObject(
      Exit.succeed({ output: { summary: 'Globex grew.' }, record: { output_format: 'json' } }),
    );
    expect(requests()[0]).toMatchObject({
      output: { type: 'json', schema: { document: { required: ['summary'] } } },
      settings: { max_output_tokens: 800, temperature: 0.2 },
      timeout_ms: 80_000,
    });
  });

  it('is a JSON value that is not an object when the schema allows it', async () => {
    const sourceDefinitionRun = documentOf(
      'model: openai/gpt-5\noutput:\n  format: json\n  schema: {type: [string, "null"]}',
    );
    const { running } = reasoningWith(answers(jsonResult(null)));

    expect(await running(sourceDefinitionRun, { text: 'x' })).toMatchObject(Exit.succeed({ output: null }));
  });

  it('is a text answer cut off at the token limit, with why it stopped in the record', async () => {
    const { running } = reasoningWith(answers(textResult('A summary that stops', { finish_reason: 'length' })));

    expect(await running(documentOf('model: openai/gpt-5'), { text: 'x' })).toMatchObject(
      Exit.succeed({ output: 'A summary that stops', record: { finish_reason: 'length' } }),
    );
  });

  it('records no instructions when the template has no system block', async () => {
    const { running } = reasoningWith(answers(textResult('Hi')));

    expect(await running(documentOf('model: openai/gpt-5'), { text: 'x' })).toMatchObject(
      Exit.succeed({ record: { prompt: { message: 'Summarize x', truncated: false } } }),
    );
  });
});

describe('a kept text or JSON value a prompt reads', () => {
  it('is written into the prompt as its text, and a JSON value is read as itself', async () => {
    const { ran, messages } = await messagesOf('{{ input.page }}\n\nFirst city: {{ input.rows.rows.first.city }}', {
      page: page.reference,
      rows: rows.reference,
    });

    expect(Exit.isSuccess(ran)).toBe(true);
    expect(messages).toMatchObject([{ content: [{ text: '# Prices\n\nThey went up.\n\nFirst city: Lyon' }] }]);
  });

  it('stands for what it holds in the input schema, and an asset the prompt does not read is not opened', async () => {
    const { running, requests, holding } = reasoningOver(answers(textResult('Noted.')));
    const schema =
      'input:\n  schema:\n    type: object\n    properties:\n      page: { type: string }\n      kept: { type: string }';

    const ran = await running(documentOf(`${sonnet}\n${schema}`, 'Read {{ input.page }}'), {
      page: page.reference,
      kept: long.reference,
    });

    expect(Exit.isSuccess(ran)).toBe(true);
    expect(requests()[0]?.messages).toMatchObject([{ content: [{ text: 'Read # Prices\n\nThey went up.' }] }]);
    expect(holding.opened()).toBe(1);
  });

  it('is read up to the characters a prompt holds, and refused at its place past them or where it is no asset of this playbook', async () => {
    const { running, requests } = reasoningOver(answers(textResult('Noted.')));

    const fitting = await running(documentOf(sonnet, '{{ input.page }}'), { page: full.reference });
    const refusals = [
      await running(documentOf(sonnet, '{{ input.page }}'), { page: long.reference }),
      await running(documentOf(sonnet, 'Read {{ input.page }}'), { page: theirs.reference }),
    ];

    expect(Exit.isSuccess(fitting)).toBe(true);
    expect(refusals).toEqual([refusedAt('/page'), refusedAt('/page')]);
    expect(requests()).toHaveLength(1);
  });
});

describe('a kept file a prompt writes', () => {
  it('is refused as not text, directly or through a filter that needs text, and the model is sent nothing', async () => {
    const { running, requests } = reasoningOver();

    const refusals = await Promise.all(
      ['Describe {{ input.photo }}', 'Describe {{ input.photo | upcase }}', 'Describe {{ input.photo | clip: 5 }}'].map(
        (body) => running(documentOf(sonnet, body), { photo: photo.reference }),
      ),
    );

    expect(refusals).toEqual([refusedAt(''), refusals[0], refusals[0]]);
    expect(requests()).toEqual([]);
  });

  it('is read by its description, a field of it or | json', async () => {
    const { ran, messages } = await messagesOf('A file of {{ input.photo.media_type }}: {{ input.photo | json }}', {
      photo: photo.reference,
    });

    expect(Exit.isSuccess(ran)).toBe(true);
    expect(messages).toMatchObject([
      { content: [{ text: `A file of image/png: ${JSON.stringify(photo.reference)}` }] },
    ]);
  });
});

describe('a run whose model a gateway without structured outputs serves', () => {
  it('answers the JSON the model wrote inside a code fence, and records that the call described the schema', async () => {
    const { exit, facts } = await runAnswered('```json\n{"verdict":"approve"}\n```');

    expect(exit).toMatchObject(Exit.succeed({ output: { verdict: 'approve' } }));
    expect(facts.find(({ type }) => type === 'model_call_answered')?.data).toMatchObject({
      finish_reason: 'stop',
      output_mode: 'described',
    });
  });

  it('is refused when the model answers in prose when asked once more too, and records the failed call as described', async () => {
    const { exit, facts } = await runAnswered('I would approve the renewal.');

    expect(exit).toMatchObject(
      Exit.fail({ _tag: 'unavailable', detail: 'The answer is not JSON after one correction; try again' }),
    );
    expect(facts.find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      provider: 'internal',
      detail: 'The answer is not JSON',
      issues: [],
      output_mode: 'described',
      repair: { outcome: 'invalid', issues: [] },
    });
  });
});

describe('run bound', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a run whose bound passes while a call of a tool that may change something is in flight', () => {
    it('gives the call up and is a conflict whose effect is unknown, because of its bound', async () => {
      const fake = await sleepingGraph();
      const { access } = reportingAccess(
        { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
        { environment: { GRAPH_API_KEY: apiKey } },
      );
      closing.push(access.close);
      const asking = toolCallsResult([['graph__sleep', { ms: 5000 }]], { usage: counted });
      const reasoning = reasoningOf({ tools: access }, answers(asking));

      const ran = await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment)));
          const running = yield* Effect.forkChild(
            Effect.flip(reasoning.prepared(source).run({}, runContextWith(reasoning.journal))),
          );
          yield* Effect.promise(() => calledOnce(fake));
          yield* TestClock.adjust(pastTheBound);
          return yield* Fiber.join(running);
        }).pipe(Effect.provide(TestClock.layer())),
      );

      expect(ran).toMatchObject({
        _tag: 'conflict',
        kind: 'effect_unknown',
        because: 'run_bound',
        record: { usage: { input: { total: 120 }, output: { total: 40 }, total: 160 } },
      });
      expect(reasoning.journal.recorded().at(-1)).toMatchObject({
        type: 'tool_call_failed',
        data: { because: 'cancelled' },
      });
      expect(reasoning.requests()).toHaveLength(1);
    });
  });
});

describe('the summary of a reasoning function whose output names a shape', () => {
  it('publishes the schema of the shape as its output schema, and the shape in its details', () => {
    const { summary } = prepared(documentOf('model: openai/gpt-5\noutput: {shape: table}'));

    expect(summary).toMatchObject({ outputSchema: shapeNamed('table').schema, details: { shape: 'table' } });
    expect(prepared(reasoningExample).summary).not.toHaveProperty('details');
  });
});
