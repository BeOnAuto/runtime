import { describe, expect, it } from 'vitest';

import { feedsOf } from './model-feeds.ts';

const fed = { y: Float32Array.of(1, 2, 3), x: null, given: null, h: null, at: null, features: 0, givens: 0 };

function shown(feeds: ReturnType<typeof feedsOf>) {
  const each: Record<string, { readonly data: readonly (number | bigint)[]; readonly dims: readonly number[] }> = {};
  for (const [name, { data, dims }] of Object.entries(feeds)) {
    each[name] = { data: [...data], dims };
  }
  return each;
}

describe('the feeds of a model', () => {
  it('are y alone over every period observed when the model takes any length', () => {
    expect(shown(feedsOf(fed))).toEqual({ y: { data: [1, 2, 3], dims: [1, 3] } });
  });

  it('keep the last periods a model of a fixed length takes, and fill the periods before the first observed with NaN', () => {
    expect([shown(feedsOf(fed, 2)), shown(feedsOf(fed, 5))]).toEqual([
      { y: { data: [2, 3], dims: [1, 2] } },
      { y: { data: [Number.NaN, Number.NaN, 1, 2, 3], dims: [1, 5] } },
    ]);
  });

  it('carry the features of each period as x, the given features ahead as given, and the periods to the end of a total as h', () => {
    const features = { ...fed, x: Float32Array.of(1, 10, 2, 20, 3, 30), features: 2 };
    const given = { ...fed, given: Float32Array.of(5, 6, 7, 8), givens: 2 };

    expect([shown(feedsOf(features, 2)), shown(feedsOf(given)), shown(feedsOf({ ...fed, h: 4 }))]).toEqual([
      { y: { data: [2, 3], dims: [1, 2] }, x: { data: [2, 20, 3, 30], dims: [1, 2, 2] } },
      { y: { data: [1, 2, 3], dims: [1, 3] }, given: { data: [5, 6, 7, 8], dims: [1, 2, 2] } },
      { y: { data: [1, 2, 3], dims: [1, 3] }, h: { data: [4n], dims: [1] } },
    ]);
  });
});
