import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedAnswer } from './answer-check.ts';

const observed = { name: 'observed', points: [{ at: '2026-10-09', value: 20 }] };

function answerWith(predicted: Schema.Json, unit = 'visits'): Schema.Json {
  return { unit, period: 'day', origin: '2026-10-09', lines: [observed, { name: 'predicted', points: [predicted] }] };
}

describe('the check of an answer before it is answered', () => {
  it('takes an answer in the series shape', async () => {
    const taken = checkedAnswer(answerWith({ at: '2026-10-10', value: 21, low: 19, high: 23 }));

    expect(await Effect.runPromise(Effect.as(taken, 'taken'))).toBe('taken');
  });

  it('refuses as not in order a predicted point whose low is above its value or whose high is below it', async () => {
    const inverted = checkedAnswer(answerWith({ at: '2026-10-10', value: 21, low: 22, high: 20 }));

    expect(await Effect.runPromise(Effect.flip(inverted))).toMatchObject({
      _tag: 'unavailable',
      kind: 'model_process_failed',
      because: 'not_in_order',
      detail:
        'The answer does not match the series shape: /lines/1/points/0/low: Expected a low of at most the value; /lines/1/points/0/high: Expected a high of at least the value',
    });
  });

  it('fails as a defect of the runtime for any other mismatch, which the model did not write', async () => {
    const unnamed = checkedAnswer(answerWith({ at: '2026-10-10', value: 21, low: 22, high: 23 }, ''));

    expect(Exit.hasDies(await Effect.runPromiseExit(unnamed))).toBe(true);
    await expect(Effect.runPromise(unnamed)).rejects.toThrow(
      'The runtime built an answer that does not match the series shape: /unit: Expected a value with a length of at least 1',
    );
  });
});
