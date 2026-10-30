import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import {
  answered,
  asked,
  askedBuild,
  buildAsked,
  modelFactsOf,
  readOf,
  runOf,
  savedFunction,
  standingOf,
  visitsRows,
  workOf,
} from '../build-testing/built-versions.ts';
import { performedOnce, performedUntilQuiet } from '../build-testing/due-driving.ts';
import type { ModelOutcome, ModelProcesses } from '../model-processes/model-processes.ts';
import { scriptedRuntimeThatFitsNothing } from '../runtime-testing/scripted-runtime.ts';
import { trainerlessDailyVisits } from '../testing/daily-documents.ts';
import type { PortOptions } from '../testing/prediction-ports.ts';
import { readBuildBrief } from '../trainer/build-reads.ts';

const playbookItself = { id: 'playbook:alpha', name: 'alpha' };

const aMinute = 60_000;

type Fitted = ReturnType<ModelProcesses['fit']> extends Effect.Effect<infer Outcome> ? Outcome : never;

function fittingTo(outcome: ModelOutcome<never> | Fitted): NonNullable<PortOptions['models']> {
  return (processes) => ({ ...processes, fit: () => Effect.succeed(outcome) });
}

function busyAtTheSecondCheck(): NonNullable<PortOptions['models']> {
  const checks = { count: 0 };
  return (processes) => ({
    ...processes,
    check: (runtime, model, fed) => {
      checks.count += 1;
      return checks.count === 2
        ? Effect.succeed({ ended: 'busy', milliseconds: 1 })
        : processes.check(runtime, model, fed);
    },
  });
}

const someDigest: unknown = expect.any(String);

const againstPersistence: unknown = [expect.objectContaining({ baseline: 'persistence' })];

function lastWideOf(spread: number): Uint8Array {
  const recipe = { recipe: 'last', steps: 2, low: spread, high: spread, features: 0, given: 0, totals: false };
  return new TextEncoder().encode(JSON.stringify(recipe));
}

function typesOf(work: readonly { readonly type: string }[]): readonly string[] {
  return work.map(({ type }) => type);
}

async function trainerlessBuild(options: PortOptions = {}): Promise<{ playbook: BuildPlaybook; build: string }> {
  const playbook = buildPlaybook(options);
  await savedFunction(playbook, { source: trainerlessDailyVisits(visitsRows.sha256) });
  return { playbook, build: await askedBuild(playbook) };
}

describe('a build of a function that names no trainer', () => {
  it('asks nobody, stands scoring at once, and refuses the routes of a trainer', async () => {
    const { playbook, build } = await trainerlessBuild();

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'started', record: { trainer: null, build: { training_sha256: someDigest } } },
    });
    expect(await standingOf(playbook)).toMatchObject({
      output: { standing: { build: { run_id: build, standing: 'scoring', expires_at: null } } },
    });
    expect(await readOf(playbook, readBuildBrief, build)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'no_trainer',
    });
  });

  it('fits the candidates of the runtime that fits its own, uploads them as a trainer’s are, scores them against the baselines and activates the one that beats them', async () => {
    const { playbook, build } = await trainerlessBuild();
    await performedUntilQuiet(playbook);
    const work = await workOf(playbook, build);
    const [built] = await modelFactsOf(playbook);

    expect(typesOf(work)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
      'candidate_uploaded',
      'candidates_fitted',
      'candidate_disqualified',
      'candidate_scored',
      'baseline_scored',
    ]);
    expect(work[3]?.data).toMatchObject({ runtime: { name: 'scripted-runtime', version: '1.0.0' } });
    expect(work[4]?.data).toMatchObject({ because: 'coverage_below_floor' });
    expect(built?.data).toMatchObject({ trained_by: playbookItself, against: againstPersistence });
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: 1 } } });
    expect(await standingOf(playbook)).toMatchObject({ output: { standing: { models: { active: { version: 1 } } } } });
  });
});

describe('a build of a function that names no trainer, as it ends', () => {
  it('keeps no version when none of its fitted candidates beats the baselines, and goes on answering from the default forecast', async () => {
    const { playbook, build } = await trainerlessBuild({
      models: fittingTo({
        ended: 'answered',
        answer: { models: [{ format: 'scripted', bytes: lastWideOf(50) }] },
        milliseconds: 1,
      }),
    });
    await performedUntilQuiet(playbook);

    expect(await runOf(playbook, build)).toMatchObject({
      output: {
        status: 'succeeded',
        output: { version: null, winner: null, candidates: [{ verdict: 'not_better' }] },
      },
    });
    expect(await modelFactsOf(playbook)).toEqual([]);
    expect(await asked(playbook, { series: 'south' })).toMatchObject({
      status: 'succeeded',
      output: { record: { version: null, default_forecast: true } },
    });
  });

  it('is refused as it starts when no runtime of the server fits its own models', async () => {
    const playbook = buildPlaybook({ runtimes: [scriptedRuntimeThatFitsNothing] });
    await savedFunction(playbook, { source: trainerlessDailyVisits(visitsRows.sha256) });

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      because: 'no_model_runtime',
    });
  });
});

describe('a build whose trainer uploads no candidate', () => {
  it('fits the candidates of the runtime that fits its own once its trainer answers none', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await answered(playbook, build, { candidates: [] });
    await performedUntilQuiet(playbook);

    expect(typesOf(await workOf(playbook, build))).toContain('candidates_fitted');
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: 1 } } });
  });

  it('records that nothing fitted when no runtime of the server fits its own, and keeps no version', async () => {
    const playbook = buildPlaybook({ runtimes: [scriptedRuntimeThatFitsNothing] });
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await answered(playbook, build, { candidates: [] });
    await performedUntilQuiet(playbook);

    expect((await workOf(playbook, build)).find(({ type }) => type === 'candidates_fitted')).toEqual({
      type: 'candidates_fitted',
      data: { runtime: null, candidates: [] },
    });
    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'succeeded', output: { version: null, candidates: [] } },
    });
  });
});

describe('the fit of a build without candidates', () => {
  it.each<readonly [string, ModelOutcome<never>, string]>([
    ['its runtime fails', { ended: 'crashed', detail: 'The fit broke', milliseconds: 1 }, 'The fit broke'],
    ['it runs out of time', { ended: 'timed_out', milliseconds: 1 }, 'its fit ended timed_out'],
  ])('fits no candidate when %s, and says why', async (_case, outcome, detail) => {
    const { playbook, build } = await trainerlessBuild({ models: fittingTo(outcome) });
    await performedUntilQuiet(playbook);

    expect((await workOf(playbook, build)).find(({ type }) => type === 'candidates_fitted')?.data).toEqual({
      runtime: { name: 'scripted-runtime', version: '1.0.0' },
      candidates: [],
      detail,
    });
  });
});

describe('the fit of a build without candidates that has to wait', () => {
  it('rests a minute while every scoring permit or model process is taken', async () => {
    const { playbook, build } = await trainerlessBuild({ models: fittingTo({ ended: 'busy', milliseconds: 1 }) });
    const { permits } = playbook.test.ports;
    const taken = [permits.take(), permits.take()];
    const performs = [
      await performedOnce(playbook.due, playbook.now()),
      await performedOnce(playbook.due, playbook.now()),
    ];
    for (const release of taken) {
      release?.();
    }
    const later = await performedOnce(playbook.due, playbook.now() + 2 * aMinute);

    expect([...performs, later]).toEqual([1, 0, 1]);
    expect(typesOf(await workOf(playbook, build))).toEqual(['dataset_assembled']);
  });

  it('takes the candidates it uploaded before a rest as uploaded once it fits them again', async () => {
    const { playbook, build } = await trainerlessBuild({ models: busyAtTheSecondCheck() });
    await performedOnce(playbook.due, playbook.now());
    const rested = typesOf(await workOf(playbook, build));
    await performedUntilQuiet(playbook, 2 * aMinute);

    expect(rested).toEqual(['dataset_assembled', 'candidate_uploaded']);
    expect(typesOf(await workOf(playbook, build)).slice(0, 4)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
      'candidate_uploaded',
      'candidates_fitted',
    ]);
  });
});

describe('the upload of the models a build fitted', () => {
  it('leaves out a fitted model in a format the function is not offered, and records one its runtime refuses', async () => {
    const notAModel = new TextEncoder().encode('not a recipe');
    const { playbook, build } = await trainerlessBuild({
      models: fittingTo({
        ended: 'answered',
        answer: {
          models: [
            { format: 'other', bytes: notAModel },
            { format: 'scripted', bytes: notAModel },
          ],
        },
        milliseconds: 1,
      }),
    });
    await performedUntilQuiet(playbook);

    expect(typesOf(await workOf(playbook, build))).toEqual([
      'dataset_assembled',
      'candidate_refused',
      'candidates_fitted',
      'baseline_scored',
    ]);
  });

  it('rests a minute when every process its check may hold is taken', async () => {
    const { playbook, build } = await trainerlessBuild({
      models: (processes) => ({ ...processes, check: () => Effect.succeed({ ended: 'busy', milliseconds: 1 }) }),
    });
    await performedOnce(playbook.due, playbook.now());

    expect(typesOf(await workOf(playbook, build))).toEqual(['dataset_assembled']);
  });
});
