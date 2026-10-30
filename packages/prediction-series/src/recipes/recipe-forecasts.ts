import { periodsSoFar } from '../calendar/periods.ts';
import { windowOf, type FedWindow, type Point } from '../forecasts/fed-windows.ts';
import { linearForecast } from '../forecasts/linear-forecasts.ts';
import { drift, historicMean, persistence, type StepsAsked } from '../forecasts/naive-forecasts.ts';
import { levelAdjustedSeasonalNaive, seasonalNaive } from '../forecasts/seasonal-forecasts.ts';
import { levelAdjustedTotal, runRate, seasonalTotal } from '../forecasts/total-forecasts.ts';
import type { LinearRecipe, Recipe, TotalAnswered } from './recipe-schema.ts';

export interface Fed {
  readonly y: Readonly<Float64Array>;
  readonly at: number | undefined;
  readonly remaining: number | undefined;
}

export type Forecast = { readonly points: readonly Point[] } | { readonly badly: string };

type NaiveRecipe = Extract<Recipe, { readonly recipe: 'persistence' | 'mean' | 'drift' }>;

type SeasonalRecipe = Extract<Recipe, { readonly recipe: 'seasonal-naive' | 'level-adjusted-seasonal-naive' }>;

type RunRateRecipe = Extract<Recipe, { readonly recipe: 'run-rate' }>;

interface TotalReach {
  readonly periods: number;
  readonly soFar: number;
}

const unfedTotal = 'The recipe answers a total, and the playbook fed it no h, the periods the total sums';

const unfedPeriod = 'The recipe reads the calendar, and the playbook fed it no at, the period of its origin';

const naiveForecasts: Readonly<Record<NaiveRecipe['recipe'], (asked: StepsAsked) => readonly Point[]>> = {
  persistence,
  mean: historicMean,
  drift,
};

function answersAnInterval({ attributes }: Recipe): boolean {
  return attributes.interval.method !== 'none';
}

function totalReachOf({ total }: TotalAnswered, { at, remaining }: Fed): TotalReach | string {
  if (remaining === undefined) {
    return unfedTotal;
  }
  if (total.accumulates === null) {
    return { periods: remaining, soFar: 0 };
  }
  return at === undefined
    ? unfedPeriod
    : { periods: remaining, soFar: periodsSoFar(total.grain, total.accumulates, at) };
}

function seasonalForecastOf(recipe: SeasonalRecipe, window: FedWindow, fed: Fed): Forecast {
  const { answers, season } = recipe.attributes;
  const interval = answersAnInterval(recipe);
  const k = recipe.recipe === 'seasonal-naive' ? undefined : recipe.attributes.k;
  if ('steps' in answers) {
    const asked = { window, steps: answers.steps, interval, season };
    return { points: k === undefined ? seasonalNaive(asked) : levelAdjustedSeasonalNaive({ ...asked, k }) };
  }
  const reach = totalReachOf(answers, fed);
  if (typeof reach === 'string') {
    return { badly: reach };
  }
  const asked = { window, ...reach, interval, season };
  return { points: [k === undefined ? seasonalTotal(asked) : levelAdjustedTotal({ ...asked, k })] };
}

function runRateOf(recipe: RunRateRecipe, window: FedWindow, fed: Fed): Forecast {
  const reach = totalReachOf(recipe.attributes.answers, fed);
  return typeof reach === 'string'
    ? { badly: reach }
    : { points: [runRate({ window, ...reach, interval: answersAnInterval(recipe) })] };
}

function linearOf(recipe: LinearRecipe, window: FedWindow, { at }: Fed): Forecast {
  const { answers, lags, marks, level, weights, interval } = recipe.attributes;
  if (at === undefined && marks !== 'none') {
    return { badly: unfedPeriod };
  }
  const bounds = interval.method === 'none' ? null : interval;
  return {
    points: linearForecast({ lags, marks, level, weights }, { window, steps: answers.steps, at: at ?? 0, bounds }),
  };
}

export function forecastOf(recipe: Recipe, fed: Fed): Forecast {
  const window = windowOf(fed.y);
  if (recipe.recipe === 'run-rate') {
    return runRateOf(recipe, window, fed);
  }
  if (recipe.recipe === 'linear') {
    return linearOf(recipe, window, fed);
  }
  if (recipe.recipe === 'seasonal-naive' || recipe.recipe === 'level-adjusted-seasonal-naive') {
    return seasonalForecastOf(recipe, window, fed);
  }
  const asked = { window, steps: recipe.attributes.answers.steps, interval: answersAnInterval(recipe) };
  return { points: naiveForecasts[recipe.recipe](asked) };
}
