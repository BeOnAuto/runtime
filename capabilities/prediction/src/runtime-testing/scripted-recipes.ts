import { readFile } from 'node:fs/promises';

import type {
  DefaultModel,
  FedShape,
  FitModels,
  FittedModel,
  FunctionShape,
  LoadModel,
  ModelAnswer,
  ModelFeeds,
} from '@on.auto/prediction-contract';
import { Schema } from 'effect';

const RecipeSchema = Schema.Struct({
  recipe: Schema.Literals([
    'mean',
    'last',
    'observed-mean',
    'not-a-number',
    'whole-numbers',
    'allocating',
    'run-rate',
    'period',
  ]),
  steps: Schema.Int,
  low: Schema.Number,
  high: Schema.Number,
  length: Schema.optionalKey(Schema.Int),
  features: Schema.Int,
  given: Schema.Int,
  totals: Schema.Boolean,
  extra: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type Recipe = typeof RecipeSchema.Type;

const decodeRecipe = Schema.decodeUnknownSync(Schema.fromJsonString(RecipeSchema));

const percentiles = 3;

const runRateDays = 7;

function inputsIssueOf(recipe: Recipe, fed: FedShape): string | undefined {
  if (recipe.extra !== undefined) {
    return `The recipe takes the inputs ${recipe.extra.join(', ')}, which the playbook does not feed`;
  }
  if (recipe.features !== fed.features) {
    return `The recipe takes ${recipe.features} features and the playbook feeds ${fed.features}`;
  }
  return recipe.given === fed.given
    ? undefined
    : `The recipe takes ${recipe.given} given features and the playbook feeds ${fed.given}`;
}

function answerIssueOf(recipe: Recipe, fed: FedShape): string | undefined {
  if (recipe.totals !== fed.totals) {
    return recipe.totals
      ? 'The recipe answers a total and the playbook asks for steps'
      : 'The recipe answers steps and the playbook asks for a total';
  }
  return recipe.totals || recipe.steps === fed.horizon
    ? undefined
    : `The recipe answers ${recipe.steps} steps and the playbook asks for ${fed.horizon}`;
}

function valuesOf(feeds: ModelFeeds, name: string): readonly number[] {
  return Array.from(feeds[name]?.data ?? [], Number);
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function levelOf(recipe: Recipe, feeds: ModelFeeds): number {
  const y = valuesOf(feeds, 'y');
  if (recipe.recipe === 'mean') {
    return meanOf(y);
  }
  if (recipe.recipe === 'observed-mean') {
    return meanOf(y.filter((value) => !Number.isNaN(value)));
  }
  if (recipe.recipe === 'run-rate') {
    return meanOf(y.slice(-runRateDays)) * valuesOf(feeds, 'h').reduce((sum, value) => sum + value, 0);
  }
  if (recipe.recipe === 'period') {
    return Number(valuesOf(feeds, 'at')[0]);
  }
  return recipe.recipe === 'last' ? Number(y.at(-1)) : Number.NaN;
}

function spreadOf(recipe: Recipe, level: number): readonly number[] {
  return recipe.recipe === 'run-rate'
    ? [level * recipe.low, level, level * recipe.high]
    : [level - recipe.low, level, level + recipe.high];
}

function answered(recipe: Recipe, feeds: ModelFeeds): ModelAnswer {
  if (recipe.recipe === 'whole-numbers') {
    return { badly: 'The recipe answers whole numbers, not a q of float32' };
  }
  if (recipe.recipe === 'allocating') {
    throw new RangeError('Array buffer allocation failed');
  }
  const steps = recipe.totals ? 1 : recipe.steps;
  const spread = spreadOf(recipe, levelOf(recipe, feeds));
  return {
    q: Float32Array.from(Array.from({ length: steps }, () => spread).flat()),
    dims: [1, steps, percentiles],
  };
}

function fittedFor({ fed }: FunctionShape, recipe: Recipe['recipe'], spread: number): FittedModel {
  const steps = fed.totals ? 1 : fed.horizon;
  const fitted: Recipe = {
    recipe: fed.totals ? 'run-rate' : recipe,
    steps,
    low: fed.totals ? 1 - spread / 10 : spread,
    high: fed.totals ? 1 + spread / 10 : spread,
    features: fed.features,
    given: fed.given,
    totals: fed.totals,
  };
  return { format: 'scripted', bytes: new TextEncoder().encode(JSON.stringify(fitted)) };
}

export const fitModels: FitModels = (shape) =>
  Promise.resolve([fittedFor(shape, 'last', 1), fittedFor(shape, 'mean', 2)]);

export const defaultModel: DefaultModel = (shape) => fittedFor(shape, 'last', 3);

export const loadModel: LoadModel = async (path) => {
  const recipe = decodeRecipe(await readFile(path, 'utf8'));
  return {
    signature: { ...recipe },
    length: recipe.length,
    issueFor: (fed) => inputsIssueOf(recipe, fed) ?? answerIssueOf(recipe, fed) ?? null,
    run: (feeds) => Promise.resolve().then(() => answered(recipe, feeds)),
  };
};
