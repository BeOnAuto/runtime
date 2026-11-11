import { Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { OutputInvalid, type ModelFailure } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningWith, type Run } from '../testing/reasoning-runs.ts';

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
