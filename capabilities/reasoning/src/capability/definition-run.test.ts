import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf, reasoningExample } from '../testing/definition-documents.ts';
import { answers, jsonResult, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

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
  it('sends the rendered instructions and message with the settings, the provider options and a timeout', async () => {
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
