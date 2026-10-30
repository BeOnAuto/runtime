import { Buffer } from 'node:buffer';

import type { CapabilityAnswer } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

const oneMebibyte = 1_048_576;

const withInstructions = documentOf(
  'model: openai/gpt-5',
  '{% system %}{{ input.rules }}{% endsystem %}{{ input.text }}',
);

const withoutInstructions = documentOf('model: openai/gpt-5', '{{ input.text }}');

const measuring = {
  onSuccess: (ran: CapabilityAnswer) => Buffer.byteLength(JSON.stringify(ran), 'utf8'),
  onFailure: () => Number.POSITIVE_INFINITY,
};

const usage = {
  input: { total: 20, uncached: 20, cache_read: 0, cache_write: 0 },
  output: { total: 64_000, text: 64_000, reasoning: null },
  total: 64_020,
};

describe('the record of a run', () => {
  it('keeps the whole prompt when it fits with the answer', async () => {
    const { running } = reasoningWith(answers(textResult('Short')));
    const text = 'é'.repeat(150_000);

    expect(await running(withInstructions, { rules: 'Be brief.', text })).toMatchObject(
      Exit.succeed({
        output: 'Short',
        record: { prompt: { instructions: 'Be brief.', message: text, truncated: false } },
      }),
    );
  });

  it('cuts the prompt so that the answer and the record take at most 1 MiB', async () => {
    const { running } = reasoningWith(answers(textResult('a'.repeat(700_000))));
    const run = await running(withInstructions, { rules: 'r'.repeat(199_000), text: 't'.repeat(199_000) });

    expect(run).toMatchObject(Exit.succeed({ output: 'a'.repeat(700_000), record: { prompt: { truncated: true } } }));
    expect(Exit.match(run, measuring)).toBeLessThanOrEqual(oneMebibyte);
    expect(Exit.match(run, measuring)).toBeGreaterThan(oneMebibyte - 4096);
  });

  it('gives the message all the room when there are no instructions', async () => {
    const { running } = reasoningWith(answers(textResult('a'.repeat(900_000))));
    const run = await running(withoutInstructions, { text: 't'.repeat(199_000) });

    expect(run).toMatchObject(Exit.succeed({ record: { prompt: { truncated: true } } }));
    expect(Exit.match(run, measuring)).toBeLessThanOrEqual(oneMebibyte);
    expect(Exit.match(run, measuring)).toBeGreaterThan(oneMebibyte - 4096);
  });

  it('cannot hold an answer that leaves no room for the prompt: the definition must ask for less', async () => {
    const { running } = reasoningWith(
      answers(textResult('a'.repeat(oneMebibyte), { usage, duration_ms: 1500, cost_usd: 0.96 })),
    );

    expect(await running(withoutInstructions, { text: 'Go' })).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The answer takes more than a run can record (1048576 bytes with its record); lower config.max_output_tokens in the reasoning function definition',
          kind: 'unworkable',
          record: { usage, duration_ms: 1500, cost_usd: 0.96 },
        }),
      ),
    );
  });
});

describe('the cost of a run', () => {
  it('is kept beside its tokens where the provider said what the run cost, and nowhere where it said nothing', async () => {
    const priced = await reasoningWith(answers(textResult('Short', { cost_usd: 0.00042 }))).running(
      withoutInstructions,
      { text: 'Go' },
    );
    const unpriced = await reasoningWith(answers(textResult('Short'))).running(withoutInstructions, { text: 'Go' });

    expect(priced).toMatchObject(Exit.succeed({ record: { cost_usd: 0.00042 } }));
    expect(Exit.match(unpriced, { onSuccess: ({ record }) => 'cost_usd' in record, onFailure: () => true })).toBe(
      false,
    );
  });
});
