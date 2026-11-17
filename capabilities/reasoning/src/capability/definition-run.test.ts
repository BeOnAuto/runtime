import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf, reasoningExample } from '../testing/definition-documents.ts';
import { answers, jsonResult, textResult, type ScriptedReply } from '../testing/index.ts';
import { reasoningOf, reasoningWith } from '../testing/reasoning-runs.ts';

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
    const source = documentOf('model: openai/gpt-5\noutput:\n  format: json\n  schema: {type: [string, "null"]}');
    const { running } = reasoningWith(answers(jsonResult(null)));

    expect(await running(source, { text: 'x' })).toMatchObject(Exit.succeed({ output: null }));
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
