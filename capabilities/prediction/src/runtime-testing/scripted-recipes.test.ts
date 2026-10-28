import type { FedShape, ModelFeeds } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import { candidateFile, type CandidateName } from './scripted-candidates.ts';
import { loadModel } from './scripted-recipes.ts';

const visitsFed: FedShape = { features: 0, given: 0, horizon: 2, totals: false };

function loaded(name: CandidateName) {
  return loadModel(candidateFile(name), 1);
}

function fedOf(values: readonly number[]): ModelFeeds {
  return { y: { data: Float32Array.from(values), dims: [1, values.length] } };
}

function totalOf(values: readonly number[], h: bigint): ModelFeeds {
  return { ...fedOf(values), h: { data: BigInt64Array.of(h), dims: [1] } };
}

describe('a scripted recipe, the model of the test runtime', () => {
  it('answers a mean, a last value, a mean of what was observed and a run-rate, each with its spread', async () => {
    const answers = await Promise.all([
      (await loaded('visits-mean')).run(fedOf([10, 12])),
      (await loaded('visits-last')).run(fedOf([10, 12])),
      (await loaded('visits-observed-mean')).run(fedOf([Number.NaN, 10, 12])),
      (await loaded('totals-run-rate')).run(
        totalOf(
          Array.from({ length: 14 }, () => 10),
          2n,
        ),
      ),
      (await loaded('totals-run-rate')).run(fedOf([10])),
    ]);

    expect(answers).toEqual([
      { q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] },
      { q: Float32Array.of(11, 12, 13, 11, 12, 13), dims: [1, 2, 3] },
      { q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] },
      { q: Float32Array.of(16, 20, 24), dims: [1, 1, 3] },
      { q: Float32Array.of(0, 0, 0), dims: [1, 1, 3] },
    ]);
  });

  it('answers numbers that are not finite, says it answered badly, or runs out of memory, as its recipe says', async () => {
    expect(await (await loaded('visits-not-a-number')).run(fedOf([1]))).toEqual({
      q: new Float32Array(6).fill(Number.NaN),
      dims: [1, 2, 3],
    });
    expect(await (await loaded('visits-whole-numbers')).run(fedOf([1]))).toEqual({
      badly: 'The recipe answers whole numbers, not a q of float32',
    });
    await expect((await loaded('visits-allocating')).run(fedOf([1]))).rejects.toThrow('allocation failed');
  });

  it('is no model when its file is not a recipe', async () => {
    await expect(loaded('not-a-model')).rejects.toThrow('JSON');
  });
});

describe('the signature of a scripted recipe', () => {
  it('is its recipe, with the periods it takes', async () => {
    const week = await loaded('visits-week');

    expect([week.signature['recipe'], week.length, (await loaded('visits-mean')).length]).toEqual([
      'last',
      7,
      undefined,
    ]);
  });

  it('has an issue with what a function feeds when its inputs, its steps or its total are not what is fed', async () => {
    const week = await loaded('visits-week');
    const orders = await loaded('orders-last');
    const totals = await loaded('totals-run-rate');

    expect([
      week.issueFor(visitsFed),
      (await loaded('visits-extra-input')).issueFor(visitsFed),
      orders.issueFor(visitsFed),
      orders.issueFor({ ...visitsFed, features: 2 }),
      orders.issueFor({ ...visitsFed, features: 2, given: 1 }),
      orders.issueFor({ features: 2, given: 1, horizon: 4, totals: false }),
      totals.issueFor(visitsFed),
      week.issueFor({ ...visitsFed, totals: true }),
      totals.issueFor({ ...visitsFed, horizon: 7, totals: true }),
    ]).toEqual([
      null,
      'The recipe takes the inputs extra, which the playbook does not feed',
      'The recipe takes 2 features and the playbook feeds 0',
      'The recipe takes 1 given features and the playbook feeds 0',
      'The recipe answers 4 steps and the playbook asks for 2',
      null,
      'The recipe answers a total and the playbook asks for steps',
      'The recipe answers steps and the playbook asks for a total',
      null,
    ]);
  });
});
