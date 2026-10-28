import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, modelFactsOf, savedFunction } from '../build-testing/built-versions.ts';
import type { ModelOutcome, ModelProcesses } from '../model-processes/model-processes.ts';
import { periodOfForm } from '../periods/grains.ts';
import { inlineScriptedRuntime } from '../runtime-testing/scripted-runtime.ts';

type Defaulted = ReturnType<ModelProcesses['defaultModel']> extends Effect.Effect<infer Outcome> ? Outcome : never;

function defaultingTo(outcome: ModelOutcome<never> | Defaulted) {
  return (processes: ModelProcesses): ModelProcesses => ({
    ...processes,
    defaultModel: () => Effect.succeed(outcome),
  });
}

function recipeBytes(recipe: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(recipe));
}

const periodRecipe = { recipe: 'period', steps: 2, low: 0, high: 0, features: 0, given: 0, totals: false };

const lastObserved = '2026-10-09';

describe('a question to a prediction function with no active version', () => {
  it('is answered by the default forecast of the runtime that fits its own models, and activates nothing', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'south' })).toMatchObject({
      status: 'succeeded',
      output: {
        output: {
          origin: lastObserved,
          lines: [
            { name: 'observed' },
            {
              name: 'predicted',
              points: [
                { at: '2026-10-10', value: 20, low: 17, high: 23 },
                { at: '2026-10-11', value: 20, low: 17, high: 23 },
              ],
            },
          ],
        },
        record: {
          version: null,
          default_forecast: true,
          runtime: { name: 'scripted-runtime', version: '1.0.0' },
          coverage: 0.8,
        },
      },
    });
    expect(await modelFactsOf(playbook)).toEqual([]);
  });
});

describe('a question answered by a default forecast of a runtime bound inline', () => {
  it('runs in the server’s own process, fed the period of its origin', async () => {
    const playbook = buildPlaybook({
      runtimes: [inlineScriptedRuntime],
      models: defaultingTo({
        ended: 'answered',
        answer: { format: 'scripted', bytes: recipeBytes(periodRecipe) },
        milliseconds: 1,
      }),
    });
    await savedFunction(playbook);
    const origin = Number(periodOfForm('day', lastObserved));

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      status: 'succeeded',
      output: {
        output: { lines: [{ name: 'observed' }, { points: [{ value: origin }] }] },
        record: { version: null, runtime: { name: 'inline-scripted-runtime' } },
      },
    });
  });
});

describe('a question whose default forecast does not come', () => {
  it.each<readonly [string, ModelOutcome<never>, object]>([
    [
      'every model process busy',
      { ended: 'busy', milliseconds: 1 },
      { reason: 'unavailable', kind: 'model_process_busy' },
    ],
    [
      'the runtime failing as it made it',
      { ended: 'crashed', detail: 'The runtime broke', milliseconds: 1 },
      { reason: 'unavailable', kind: 'model_process_failed', detail: 'The runtime broke' },
    ],
    [
      'the runtime saying it answered badly',
      { ended: 'badly', detail: 'No default', milliseconds: 1 },
      { reason: 'unavailable', kind: 'model_process_failed', detail: 'No default' },
    ],
    [
      'the job running out of time',
      { ended: 'timed_out', milliseconds: 1 },
      { reason: 'unavailable', kind: 'model_process_failed', detail: 'The model process ended before it answered' },
    ],
  ])('is refused with %s', async (_case, outcome, refusal) => {
    const playbook = buildPlaybook({ models: defaultingTo(outcome) });
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'north' })).toMatchObject({ status: 'rejected', ...refusal });
  });

  it('is refused when the default forecast is in a format no runtime of the server executes', async () => {
    const playbook = buildPlaybook({
      models: defaultingTo({ ended: 'answered', answer: { format: 'other', bytes: recipeBytes({}) }, milliseconds: 1 }),
    });
    await savedFunction(playbook);

    expect(await asked(playbook, { series: 'north' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      because: 'no_model_runtime',
      detail:
        'No model runtime this server has installed executes the format other of the default forecast; install the extension that executes it, or ask for a build',
    });
  });
});
