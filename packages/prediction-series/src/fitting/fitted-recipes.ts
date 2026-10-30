import type { FunctionShape, TrainingRows } from '@on.auto/prediction-contract';

import type { Recipe } from '../recipes/recipe-schema.ts';
import { fittedLinear } from './linear-fit.ts';

type Answers = Extract<Recipe, { readonly recipe: 'seasonal-naive' }>['attributes']['answers'];

const residual: { readonly method: 'residual' } = { method: 'residual' };

function answersOf({ fed, grain, accumulates }: FunctionShape): Answers {
  return fed.totals ? { total: { grain, accumulates } } : { steps: fed.horizon };
}

function levelAdjustedOf(shape: FunctionShape, season: number): Recipe {
  return {
    recipe: 'level-adjusted-seasonal-naive',
    attributes: { answers: answersOf(shape), season, k: season, interval: residual },
  };
}

function levelAdjustedRecipesOf(shape: FunctionShape): readonly Recipe[] {
  return shape.season === null ? [] : [levelAdjustedOf(shape, shape.season)];
}

function runRateOf({ grain, accumulates }: FunctionShape): Recipe {
  return { recipe: 'run-rate', attributes: { answers: { total: { grain, accumulates } }, interval: residual } };
}

function stepRecipeOf(recipe: 'persistence' | 'mean' | 'drift', { fed }: FunctionShape): Recipe {
  return { recipe, attributes: { answers: { steps: fed.horizon }, interval: residual } };
}

function linearRecipesOf(shape: FunctionShape, training: TrainingRows): readonly Recipe[] {
  const fitted = fittedLinear(shape, training);
  if (fitted === undefined) {
    return [];
  }
  const { model, bounds } = fitted;
  return [
    {
      recipe: 'linear',
      attributes: {
        answers: { steps: shape.fed.horizon },
        grain: shape.grain,
        lags: model.lags,
        marks: model.marks,
        level: model.level,
        weights: model.weights,
        interval: { method: 'conformal', low: bounds.low, high: bounds.high },
      },
    },
  ];
}

export function defaultRecipeOf(shape: FunctionShape): Recipe {
  const { fed, season } = shape;
  if (season !== null) {
    return levelAdjustedOf(shape, season);
  }
  return fed.totals ? runRateOf(shape) : stepRecipeOf('persistence', shape);
}

export function fittedRecipesOf(shape: FunctionShape, training: TrainingRows): readonly Recipe[] {
  if (shape.fed.totals) {
    return levelAdjustedRecipesOf(shape);
  }
  return [
    stepRecipeOf('mean', shape),
    stepRecipeOf('drift', shape),
    ...levelAdjustedRecipesOf(shape),
    ...linearRecipesOf(shape, training),
  ];
}
