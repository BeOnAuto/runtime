import { Buffer } from 'node:buffer';

import type { CapabilityAnswer } from '@on.auto/definitions';
import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { type ModelFailure, OutputInvalid } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult } from '../testing/index.ts';
import { reasoningWith, type Run } from '../testing/reasoning-runs.ts';

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

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

function failingWith(failure: () => ModelFailure): Promise<Run> {
  return reasoningWith(() => Effect.fail(failure())).running(jsonDefinition, { text: 'x' });
}

const unknownTokens = { total: null, uncached: null, cache_read: null, cache_write: null };

const spentOnTheCall = {
  record: {
    usage: { input: unknownTokens, output: { total: null, text: null, reasoning: null }, total: null },
    duration_ms: 0,
  },
};

const usageOfTheCorrection = {
  input: { total: 30, uncached: 30, cache_read: 0, cache_write: null },
  output: { total: 12, text: 12, reasoning: 0 },
  total: 42,
};

const correctedOnce = {
  outcome: 'invalid' as const,
  issues: [{ pointer: '/summary', detail: 'Expected string' }],
  usage: usageOfTheCorrection,
  duration_ms: 900,
};

function missedTheSchema(more: Partial<ConstructorParameters<typeof OutputInvalid>[0]>): OutputInvalid {
  return new OutputInvalid({
    detail: 'The answer does not match the output schema',
    provider: 'openai',
    finish_reason: 'stop',
    raw_finish_reason: 'stop',
    usage: null,
    issues: [{ pointer: '/summary', detail: 'Expected a value with a length of at most 80' }],
    ...more,
  });
}

describe('a JSON answer that missed its schema and was asked for once more', () => {
  it('is unavailable, saying it missed the schema after one correction, with the issues of the corrected answer', async () => {
    expect(await failingWith(() => missedTheSchema({ repair: correctedOnce }))).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'The answer does not match the output schema after one correction (/summary: Expected a value with a length of at most 80); try again',
          ...spentOnTheCall,
        }),
      ),
    );
  });

  it('is a conflict, naming the corrected answer, when the corrected answer was cut off at the token limit', async () => {
    const cutOff = missedTheSchema({ finish_reason: 'length', issues: [], repair: correctedOnce });

    expect(await failingWith(() => cutOff)).toMatchObject(
      Exit.fail({
        _tag: 'conflict',
        kind: 'unworkable',
        detail:
          'openai stopped the corrected answer at max_output_tokens (200) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition, or, where one answer holds several pieces of work, give each piece a function of its own',
      }),
    );
  });
});

describe('a JSON answer that missed its schema when the request for a correction failed', () => {
  it('is unavailable, with the issues of the first answer, saying how that request failed', async () => {
    const issues = [{ pointer: '/summary', detail: 'Expected a value with a length of at most 80' }];
    const failedToCorrect = missedTheSchema({
      repair: { outcome: 'failed', because: 'provider_unavailable', issues, duration_ms: 3 },
    });

    expect(await failingWith(() => failedToCorrect)).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'The answer does not match the output schema (/summary: Expected a value with a length of at most 80); the request for a correction failed (provider_unavailable); try again',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a JSON answer that missed its schema when the run had no room to ask for it again', () => {
  it.each([
    ['input_tokens', 'the run had too few input tokens left'],
    ['context_window', "it would not fit in the model's context window"],
    ['time', 'too little time was left'],
  ] as const)('is unavailable, saying no correction was attempted for want of %s', async (because, words) => {
    const skipped = missedTheSchema({ repair: { outcome: 'skipped', because } });

    expect(await failingWith(() => skipped)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: `The answer does not match the output schema (/summary: Expected a value with a length of at most 80); no correction was attempted, as ${words}; try again`,
          ...spentOnTheCall,
        }),
      ),
    );
  });
});
