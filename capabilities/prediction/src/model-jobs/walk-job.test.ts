import type { LoadedModel, ModelFeeds } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import type { SeriesRows } from '../files/series-rows.ts';
import { walked } from './walk-job.ts';

interface Fed {
  readonly names: readonly string[];
  readonly y: readonly number[];
  readonly given: readonly number[] | undefined;
  readonly h: bigint | undefined;
}

function fedOf(feeds: ModelFeeds): Fed {
  return {
    names: Object.keys(feeds),
    y: [...(feeds['y']?.data ?? [])].map(Number),
    given: feeds['given'] === undefined ? undefined : [...feeds['given'].data].map(Number),
    h: feeds['h'] === undefined ? undefined : BigInt(feeds['h'].data[0] ?? 0),
  };
}

function lastValueModel(steps: (feeds: ModelFeeds) => number, heard: (fed: Fed) => void = () => {}): LoadedModel {
  return {
    signature: {},
    length: undefined,
    issueFor: () => null,
    run: (feeds) => {
      heard(fedOf(feeds));
      const last = Number(feeds['y']?.data.at(-1));
      const answered = steps(feeds);
      return Promise.resolve({
        q: Float32Array.from({ length: answered * 3 }, (_, index) => last + (index % 3) - 1),
        dims: [1, answered, 3],
      });
    },
  };
}

const periods = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

interface Kept {
  readonly series: string;
  readonly values: readonly number[];
  readonly promotion: readonly number[];
}

function rowsOf(features: number): readonly SeriesRows[] {
  return [
    { series: 'north', values: [10, 11, 12, 13], promotion: [0, 1, 0, 1] },
    { series: 'south', values: [20, 21, 22, 23], promotion: [1, 0, 1, 0] },
  ].map(({ series, values, promotion }: Kept) => ({
    series,
    periods,
    values: Float64Array.from(values),
    features: Float64Array.from(features === 0 ? [] : promotion),
  }));
}

const rows = rowsOf(0);

const walk = {
  runtime: 'file:///runtime.ts',
  model: 'm',
  threads: 1,
  rows: 'r',
  window: 4,
  holdout: 2,
  steps: 2,
  features: 0,
  given: [],
  remaining: null,
  first: null,
};

describe('a walk of a model over the held-back origins of each series', () => {
  it('feeds each series up to each held-back origin and answers every step of every origin, series by series', async () => {
    const seen: Fed[] = [];
    const answer = await walked(
      {
        model: lastValueModel(
          () => 2,
          (fed) => {
            seen.push(fed);
          },
        ),
        walk,
        signal: undefined,
      },
      rows,
    );

    expect(answer).toEqual({
      series: ['north', 'south'],
      q: [
        Float32Array.of(11, 12, 13, 11, 12, 13, 12, 13, 14, 12, 13, 14),
        Float32Array.of(21, 22, 23, 21, 22, 23, 22, 23, 24, 22, 23, 24),
      ],
    });
    expect(seen.map(({ y }) => y)).toEqual([
      [10, 11, 12],
      [10, 11, 12, 13],
      [20, 21, 22],
      [20, 21, 22, 23],
    ]);
  });
});

describe('a walk of a model that takes given features or predicts a total', () => {
  it('feeds the given features of the steps ahead, NaN past the last row, and the periods to the end of a total as h', async () => {
    const seen: Fed[] = [];
    const givenWalk = { ...walk, features: 1, given: [0], remaining: [3, 1] };
    await walked(
      {
        model: lastValueModel(
          () => 1,
          (fed) => {
            seen.push(fed);
          },
        ),
        walk: givenWalk,
        signal: undefined,
      },
      rowsOf(1),
    );

    expect(seen.slice(0, 2)).toEqual([
      { names: ['y', 'x', 'given', 'h'], y: [10, 11, 12], given: [1, Number.NaN, Number.NaN], h: 3n },
      { names: ['y', 'x', 'given', 'h'], y: [10, 11, 12, 13], given: [Number.NaN], h: 1n },
    ]);
  });

  it('answers badly when its runtime says the model answered badly', async () => {
    const badly: LoadedModel = { ...lastValueModel(() => 2), run: () => Promise.resolve({ badly: 'No q' }) };

    expect(await walked({ model: badly, walk, signal: undefined }, rows)).toEqual({ badly: 'No q' });
  });

  it('answers badly when the model answers q of another shape', async () => {
    expect(await walked({ model: lastValueModel(() => 3), walk, signal: undefined }, rows)).toEqual({
      badly: 'The model answered q of the shape [1, 3, 3] where [1, 2, 3] was expected',
    });
  });
});

describe('a walk of a model whose runtime reads the calendar', () => {
  it('feeds each origin the index of its period as at, counted from the first period of the rows', async () => {
    const seen: ModelFeeds[] = [];
    const model: LoadedModel = {
      ...lastValueModel(() => 2),
      run: (feeds) => {
        seen.push(feeds);
        return lastValueModel(() => 2).run(feeds);
      },
    };

    await walked({ model, walk: { ...walk, first: 100 }, signal: undefined }, rows.slice(0, 1));

    expect(seen.map((feeds) => feeds['at']?.data)).toEqual([BigInt64Array.of(102n), BigInt64Array.of(103n)]);
  });
});

describe('a walk stopped as it runs', () => {
  it('fails at the next series once its signal is aborted, so a walk in the server’s own process ends at its deadline', async () => {
    const stopping = new AbortController();
    stopping.abort();

    await expect(walked({ model: lastValueModel(() => 2), walk, signal: stopping.signal }, rows)).rejects.toThrow(
      'The walk was stopped before it walked every series',
    );
  });
});
