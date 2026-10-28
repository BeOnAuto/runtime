import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FedShape, FunctionShape, ModelFeeds } from '@on.auto/prediction-contract';
import { describe, expect, it, onTestFinished } from 'vitest';

import { defaultModel, fitModels, loadModel } from './series-models.ts';

const wednesday = 20_754n;

const visitsFed: FedShape = { features: 0, given: 0, horizon: 2, totals: false };

const daily: FunctionShape = { fed: visitsFed, grain: 'day', season: 7, accumulates: null, holdout: 8 };

const persistence = { recipe: 'persistence', attributes: { answers: { steps: 2 }, interval: { method: 'none' } } };

const runRate = {
  recipe: 'run-rate',
  attributes: { answers: { total: { grain: 'day', accumulates: 'week' } }, interval: { method: 'none' } },
};

const linear = {
  recipe: 'linear',
  attributes: {
    answers: { steps: 1 },
    grain: 'day',
    lags: [1],
    marks: 'day-of-week',
    level: 1,
    weights: [0, 1, 0, 0, 0, 0, 0, 0],
    interval: { method: 'conformal', low: [-0.5], high: [0.5] },
  },
};

function recipeFile(contents: string | object): string {
  const folder = mkdtempSync(join(tmpdir(), 'series-recipe-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const path = join(folder, 'model.series');
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

function fedOf(values: readonly number[], extra: { readonly at?: bigint; readonly h?: bigint } = {}): ModelFeeds {
  return {
    y: { data: Float32Array.from(values), dims: [1, values.length] },
    ...(extra.at === undefined ? {} : { at: { data: BigInt64Array.of(extra.at), dims: [1] } }),
    ...(extra.h === undefined ? {} : { h: { data: BigInt64Array.of(extra.h), dims: [1] } }),
  };
}

function loadedFrom(bytes: Readonly<Uint8Array>): ReturnType<typeof loadModel> {
  return loadModel(recipeFile(new TextDecoder().decode(bytes)), 1);
}

async function answeredQ(model: Awaited<ReturnType<typeof loadModel>>, feeds: ModelFeeds) {
  const answer = await model.run(feeds);
  if ('badly' in answer) {
    throw new Error(answer.badly);
  }
  return answer;
}

describe('a recipe of series, loaded as a model', () => {
  it('is its own signature, takes a window of any length, and answers the percentiles of each step it names', async () => {
    const model = await loadModel(recipeFile(persistence), 1);

    expect([model.signature, model.length]).toEqual([persistence, undefined]);
    expect(await model.run(fedOf([1, 2, 3]))).toEqual({ q: Float32Array.of(3, 3, 3, 3, 3, 3), dims: [1, 2, 3] });
  });

  it('has an issue with a function that asks for other steps, or for a total where it answers steps, and the other way about', async () => {
    const steps = await loadModel(recipeFile(persistence), 1);
    const total = await loadModel(recipeFile(runRate), 1);

    expect([
      steps.issueFor(visitsFed),
      steps.issueFor({ ...visitsFed, horizon: 4 }),
      steps.issueFor({ ...visitsFed, totals: true }),
      total.issueFor({ ...visitsFed, totals: true }),
      total.issueFor(visitsFed),
    ]).toEqual([
      null,
      'The recipe answers 2 steps and the playbook asks for 4',
      'The recipe answers steps and the playbook asks for a total',
      null,
      'The recipe answers a total and the playbook asks for steps',
    ]);
  });
});

describe('a recipe of series that answers a total or reads the calendar', () => {
  it('answers a total from the periods it is fed as h and the period of its origin it is fed as at', async () => {
    const model = await loadModel(recipeFile(runRate), 1);

    expect(await model.run(fedOf([10, 10, 10, 10, 12, 8, 10], { at: wednesday, h: 4n }))).toEqual({
      q: Float32Array.of(40, 40, 40),
      dims: [1, 1, 3],
    });
  });

  it('says it answered badly when the playbook feeds a total no h, or a recipe that reads the calendar no at', async () => {
    const total = await loadModel(recipeFile(runRate), 1);
    const marked = await loadModel(recipeFile(linear), 1);

    expect([
      await total.run(fedOf([1, 2])),
      await total.run(fedOf([1, 2], { h: 2n })),
      await marked.run(fedOf([1, 2])),
      await marked.run(fedOf([4, 4], { at: wednesday })),
    ]).toEqual([
      { badly: 'The recipe answers a total, and the playbook fed it no h, the periods the total sums' },
      { badly: 'The recipe reads the calendar, and the playbook fed it no at, the period of its origin' },
      { badly: 'The recipe reads the calendar, and the playbook fed it no at, the period of its origin' },
      { q: Float32Array.of(2, 4, 6), dims: [1, 1, 3] },
    ]);
  });
});

describe('a seasonal recipe of series that answers steps', () => {
  it('repeats the value a season earlier, the recipe a function names to forecast as its baseline does', async () => {
    const seasonal = await loadModel(
      recipeFile({
        recipe: 'seasonal-naive',
        attributes: { answers: { steps: 2 }, season: 3, interval: { method: 'none' } },
      }),
      1,
    );

    expect(await seasonal.run(fedOf([1, 2, 3, 1, 2, 3]))).toEqual({
      q: Float32Array.of(1, 1, 1, 2, 2, 2),
      dims: [1, 2, 3],
    });
  });
});

describe('a seasonal recipe of series that answers a total', () => {
  it('sums the same periods a season earlier, scaled by the level in its level-adjusted form, and needs no calendar where it accumulates to nothing named', async () => {
    const total = { total: { grain: 'day', accumulates: null } };
    const none = { method: 'none' };
    const seasonal = await loadModel(
      recipeFile({ recipe: 'seasonal-naive', attributes: { answers: total, season: 3, interval: none } }),
      1,
    );
    const level = await loadModel(
      recipeFile({
        recipe: 'level-adjusted-seasonal-naive',
        attributes: { answers: total, season: 3, k: 3, interval: none },
      }),
      1,
    );
    const growing = [1, 2, 3, 2, 4, 6, 4, 8, 12];

    expect([
      await seasonal.run(fedOf(growing, { h: 2n })),
      await level.run(fedOf(growing, { h: 2n })),
      await seasonal.run(fedOf(growing)),
    ]).toEqual([
      { q: Float32Array.of(12, 12, 12), dims: [1, 1, 3] },
      { q: Float32Array.of(24, 24, 24), dims: [1, 1, 3] },
      { badly: 'The recipe answers a total, and the playbook fed it no h, the periods the total sums' },
    ]);
  });

  it('reads no calendar of a linear recipe whose marks are none', async () => {
    const plain = {
      recipe: 'linear',
      attributes: {
        answers: { steps: 1 },
        grain: 'week',
        lags: [1],
        marks: 'none',
        level: 1,
        weights: [0, 1],
        interval: { method: 'none' },
      },
    };

    expect(await (await loadModel(recipeFile(plain), 1)).run(fedOf([4, 5]))).toEqual({
      q: Float32Array.of(5, 5, 5),
      dims: [1, 1, 3],
    });
  });
});

describe('a file the series runtime refuses to load', () => {
  it.each<readonly [string, string | object, string]>([
    ['is not JSON', 'not a recipe', 'JSON'],
    ['names no recipe the runtime knows', { recipe: 'neural', attributes: {} }, 'Expected'],
    ['takes more than 16 KiB', `${JSON.stringify(persistence)}${' '.repeat(16_384)}`, 'past the 16384 bytes'],
    [
      'weighs other terms than its lags and marks',
      { ...linear, attributes: { ...linear.attributes, weights: [1, 1] } },
      'weighs 8 terms, and this one gives 2 weights',
    ],
    [
      'bounds other steps than it answers',
      { ...linear, attributes: { ...linear.attributes, interval: { method: 'conformal', low: [], high: [] } } },
      'a low and a high for each of the 1 steps',
    ],
  ])('is refused when it %s', async (_case, contents, words) => {
    await expect(loadModel(recipeFile(contents), 1)).rejects.toThrow(words);
  });

  it('takes a linear recipe that answers no interval, whatever its bounds would have held', async () => {
    const model = await loadModel(
      recipeFile({ ...linear, attributes: { ...linear.attributes, interval: { method: 'none' } } }),
      1,
    );

    expect(await model.run(fedOf([4, 4], { at: wednesday }))).toEqual({ q: Float32Array.of(4, 4, 4), dims: [1, 1, 3] });
  });
});

describe('the models the series runtime fits and defaults to', () => {
  it('are recipes in the format series, each one it loads and runs for the function they were fitted for', async () => {
    const days = Array.from({ length: 40 }, (_, day) => 10 + (day % 7));
    const fitted = await fitModels(daily, { first: 20_752, series: [Float64Array.from(days)] });
    const models = await Promise.all(fitted.map(({ bytes }) => loadedFrom(bytes)));
    const answers = await Promise.all(models.map((model) => answeredQ(model, fedOf(days, { at: 20_791n }))));

    expect(new Set(fitted.map(({ format }) => format))).toEqual(new Set(['series']));
    expect(models.map(({ issueFor }) => issueFor(visitsFed))).toEqual([null, null, null, null]);
    expect(new Set(answers.map(({ dims }) => dims.join()))).toEqual(new Set(['1,2,3']));
  });

  it('default to the level-adjusted seasonal naive, which needs two seasons and the steps asked and answers the seasonal naive or persistence before', async () => {
    const { format, bytes } = defaultModel(daily);
    const model = await loadedFrom(bytes);
    const medians = async (values: readonly number[]) => {
      const { q } = await answeredQ(model, fedOf(values, { at: wednesday }));
      return [q[1], q[4]];
    };
    const doubled = Array.from({ length: 16 }, (_, day) => Math.min(2, Math.floor(day / 9) + 1));

    expect(format).toBe('series');
    expect([
      await medians(doubled),
      await medians(doubled.slice(1)),
      await medians([1, 2, 3, 4, 5, 6, 7, 1, 2]),
      await medians([1, 2, 3, 4, 5, 6, 7, 1]),
    ]).toEqual([
      [4, 4],
      [2, 2],
      [3, 4],
      [1, 1],
    ]);
  });
});
