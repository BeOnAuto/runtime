import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { budgetOf } from '../testing/input-budgets.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { defaultBounds, stepsOf, toolOf } from '../testing/step-runs.ts';

const search = toolOf('graph', 'search');

const counted = {
  input: { total: 1200, uncached: 1200, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 1240,
};

describe('the room of a run that calls tools, sent with each model call', () => {
  it("is the input tokens the run has left, the model's context window and when the run's bound ends", async () => {
    const startedAt = new Date().toISOString();
    const steps = stepsOf({
      tools: [search],
      before: { startedAt, modelCallsBefore: 0, calls: [] },
      bounds: { ...defaultBounds, runBoundMs: 600_000, limits: { contextWindow: 200_000, budget: budgetOf(50_000) } },
      replies: [
        answers(toolCallsResult([['graph__search', { query: 'acme' }]], { usage: counted })),
        answers(textResult('Acme has 2 rows.')),
      ],
    });

    await Effect.runPromise(steps.stepping);

    const endsAt = Date.parse(startedAt) + 600_000;
    expect(steps.requests().map(({ room }) => room)).toEqual([
      { input_tokens: 50_000, context_window: 200_000, ends_at: endsAt },
      { input_tokens: 48_800, context_window: 200_000, ends_at: endsAt },
    ]);
  });

  it('is no input tokens at all once the run has spent them', async () => {
    const steps = stepsOf({
      tools: [search],
      bounds: { ...defaultBounds, runBoundMs: 600_000, limits: { contextWindow: undefined, budget: budgetOf(1000) } },
      replies: [
        answers(toolCallsResult([['graph__search', { query: 'acme' }]], { usage: counted })),
        answers(textResult('Acme has 2 rows.')),
      ],
    });

    await Effect.runPromise(steps.stepping);

    expect(steps.requests().map(({ room }) => room?.input_tokens)).toEqual([1000, 0]);
  });
});
