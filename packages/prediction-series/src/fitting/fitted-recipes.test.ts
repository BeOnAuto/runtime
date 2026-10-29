import type { FunctionShape } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import { defaultRecipeOf, fittedRecipesOf } from './fitted-recipes.ts';

const steps: FunctionShape = {
  fed: { features: 0, given: 0, horizon: 2, totals: false },
  grain: 'day',
  season: 7,
  accumulates: null,
  holdout: 8,
};

const totals: FunctionShape = { ...steps, fed: { ...steps.fed, horizon: 7, totals: true }, accumulates: 'week' };

const flatTraining = { first: 20_752, series: [Float64Array.from({ length: 40 }, () => 5)] };

const residual = { method: 'residual' };

function namesOf(recipes: readonly { readonly recipe: string }[]): readonly string[] {
  return recipes.map(({ recipe }) => recipe);
}

describe('the recipes a build without candidates fits from its training rows', () => {
  it('are the mean, the drift, the level-adjusted seasonal naive and the linear model, for steps of a season, and never the baselines they are scored against', () => {
    expect(namesOf(fittedRecipesOf(steps, flatTraining))).toEqual([
      'mean',
      'drift',
      'level-adjusted-seasonal-naive',
      'linear',
    ]);
  });

  it('leave the seasonal one out without a season, and the linear model when nothing can be fitted', () => {
    const empty = { first: 0, series: [Float64Array.of(Number.NaN)] };

    expect(namesOf(fittedRecipesOf({ ...steps, season: null }, empty))).toEqual(['mean', 'drift']);
  });

  it('are the level-adjusted seasonal naive of the total with a season, and none without, since the run-rate and the seasonal sum are its baselines', () => {
    expect([fittedRecipesOf(totals, flatTraining), fittedRecipesOf({ ...totals, season: null }, flatTraining)]).toEqual(
      [
        [
          {
            recipe: 'level-adjusted-seasonal-naive',
            attributes: {
              answers: { total: { grain: 'day', accumulates: 'week' } },
              season: 7,
              k: 7,
              interval: residual,
            },
          },
        ],
        [],
      ],
    );
  });
});

describe('the default forecast of a function with no active version', () => {
  it('is the level-adjusted seasonal naive with a season, of the steps or the total', () => {
    expect([defaultRecipeOf(steps), defaultRecipeOf(totals)]).toEqual([
      {
        recipe: 'level-adjusted-seasonal-naive',
        attributes: { answers: { steps: 2 }, season: 7, k: 7, interval: residual },
      },
      {
        recipe: 'level-adjusted-seasonal-naive',
        attributes: { answers: { total: { grain: 'day', accumulates: 'week' } }, season: 7, k: 7, interval: residual },
      },
    ]);
  });

  it('is persistence without a season, or the run-rate of a total', () => {
    expect([defaultRecipeOf({ ...steps, season: null }), defaultRecipeOf({ ...totals, season: null })]).toEqual([
      { recipe: 'persistence', attributes: { answers: { steps: 2 }, interval: residual } },
      {
        recipe: 'run-rate',
        attributes: { answers: { total: { grain: 'day', accumulates: 'week' } }, interval: residual },
      },
    ]);
  });
});
