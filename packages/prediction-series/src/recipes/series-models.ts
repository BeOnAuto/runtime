import { readFile, stat } from 'node:fs/promises';

import type {
  DefaultModel,
  FedShape,
  FedTensor,
  FitModels,
  FittedModel,
  LoadModel,
  ModelAnswer,
  ModelFeeds,
} from '@on.auto/prediction-contract';
import { Schema } from 'effect';

import { defaultRecipeOf, fittedRecipesOf } from '../fitting/fitted-recipes.ts';
import { forecastOf } from './recipe-forecasts.ts';
import {
  linearIssueOf,
  mostRecipeBytes,
  recipeBytes,
  RecipeSchema,
  seriesFormat,
  type Recipe,
} from './recipe-schema.ts';

const decodeRecipe = Schema.decodeUnknownSync(Schema.fromJsonString(RecipeSchema));

const percentiles = 3;

function numbersOf(tensor: FedTensor | undefined): readonly number[] {
  if (tensor === undefined) {
    return [];
  }
  const values: readonly (number | bigint)[] = [...tensor.data];
  return values.map(Number);
}

export function issueOf({ attributes }: Recipe, fed: FedShape): string | null {
  const { answers } = attributes;
  if ('total' in answers) {
    return fed.totals ? null : 'The recipe answers a total and the playbook asks for steps';
  }
  if (fed.totals) {
    return 'The recipe answers steps and the playbook asks for a total';
  }
  return answers.steps === fed.horizon
    ? null
    : `The recipe answers ${answers.steps} steps and the playbook asks for ${fed.horizon}`;
}

function answerOf(recipe: Recipe, feeds: ModelFeeds): ModelAnswer {
  const forecast = forecastOf(recipe, {
    y: Float64Array.from(numbersOf(feeds['y'])),
    at: numbersOf(feeds['at'])[0],
    remaining: numbersOf(feeds['h'])[0],
  });
  if ('badly' in forecast) {
    return forecast;
  }
  const q = Float32Array.from(forecast.points.flatMap(({ low, value, high }) => [low, value, high]));
  return { q, dims: [1, forecast.points.length, percentiles] };
}

async function recipeIn(path: string): Promise<Recipe> {
  const { size } = await stat(path);
  if (size > mostRecipeBytes) {
    throw new Error(`The recipe takes ${size} bytes, past the ${mostRecipeBytes} bytes a recipe of series may take`);
  }
  const recipe = decodeRecipe(await readFile(path, 'utf8'));
  const issue = recipe.recipe === 'linear' ? linearIssueOf(recipe) : undefined;
  if (issue !== undefined) {
    throw new Error(issue);
  }
  return recipe;
}

export const loadModel: LoadModel = async (path) => {
  const recipe = await recipeIn(path);
  return {
    signature: recipe,
    length: undefined,
    issueFor: (fed) => issueOf(recipe, fed),
    run: (feeds) => Promise.resolve().then(() => answerOf(recipe, feeds)),
  };
};

function modelOf(recipe: Recipe): FittedModel {
  return { format: seriesFormat, bytes: recipeBytes(recipe) };
}

export const fitModels: FitModels = (shape, training) =>
  Promise.resolve().then(() => fittedRecipesOf(shape, training).map((recipe) => modelOf(recipe)));

export const defaultModel: DefaultModel = (shape) => modelOf(defaultRecipeOf(shape));
