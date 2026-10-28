import { Schema } from 'effect';

import { markColumns } from '../calendar/periods.ts';

export const seriesFormat = 'series';

export const mostRecipeBytes = 16_384;

const Periods = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000));

const Season = Schema.Int.check(Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(366));

const GrainSchema = Schema.Literals(['day', 'week', 'month', 'quarter', 'year']);

const EnclosingSchema = Schema.Literals(['week', 'month', 'quarter', 'year']);

const Residual = Schema.Struct({ method: Schema.Literal('residual') });

const NoInterval = Schema.Struct({ method: Schema.Literal('none') });

const Conformal = Schema.Struct({
  method: Schema.Literal('conformal'),
  low: Schema.Array(Schema.Finite),
  high: Schema.Array(Schema.Finite),
});

const StepsAnswer = Schema.Struct({ steps: Periods });

const TotalAnswer = Schema.Struct({
  total: Schema.Struct({ grain: GrainSchema, accumulates: Schema.NullOr(EnclosingSchema) }),
});

const Answers = Schema.Union([StepsAnswer, TotalAnswer]);

const ResidualOrNone = Schema.Union([Residual, NoInterval]);

const NaiveRecipeSchema = Schema.Struct({
  recipe: Schema.Literals(['persistence', 'mean', 'drift']),
  attributes: Schema.Struct({ answers: StepsAnswer, interval: ResidualOrNone }),
});

const SeasonalRecipeSchema = Schema.Struct({
  recipe: Schema.Literal('seasonal-naive'),
  attributes: Schema.Struct({ answers: Answers, season: Season, interval: ResidualOrNone }),
});

const LevelRecipeSchema = Schema.Struct({
  recipe: Schema.Literal('level-adjusted-seasonal-naive'),
  attributes: Schema.Struct({ answers: Answers, season: Season, k: Periods, interval: ResidualOrNone }),
});

const RunRateRecipeSchema = Schema.Struct({
  recipe: Schema.Literal('run-rate'),
  attributes: Schema.Struct({ answers: TotalAnswer, interval: ResidualOrNone }),
});

const LinearRecipeSchema = Schema.Struct({
  recipe: Schema.Literal('linear'),
  attributes: Schema.Struct({
    answers: StepsAnswer,
    grain: GrainSchema,
    lags: Schema.NonEmptyArray(Periods),
    marks: Schema.Literals(['day-of-week', 'month-of-year', 'quarter-of-year', 'none']),
    level: Periods,
    weights: Schema.Array(Schema.Finite),
    interval: Schema.Union([Conformal, NoInterval]),
  }),
});

export const RecipeSchema = Schema.Union([
  NaiveRecipeSchema,
  SeasonalRecipeSchema,
  LevelRecipeSchema,
  RunRateRecipeSchema,
  LinearRecipeSchema,
]);

export type Recipe = typeof RecipeSchema.Type;

export type LinearRecipe = typeof LinearRecipeSchema.Type;

export type TotalAnswered = typeof TotalAnswer.Type;

export function linearIssueOf({ attributes }: LinearRecipe): string | undefined {
  const { answers, lags, marks, weights, interval } = attributes;
  const width = 1 + lags.length + markColumns(marks);
  if (weights.length !== width) {
    return `A linear recipe of ${lags.length} lags and the marks ${marks} weighs ${width} terms, and this one gives ${weights.length} weights`;
  }
  return interval.method === 'conformal' &&
    (interval.low.length !== answers.steps || interval.high.length !== answers.steps)
    ? `A conformal interval gives a low and a high for each of the ${answers.steps} steps the recipe answers`
    : undefined;
}

export function recipeBytes(recipe: Recipe): Readonly<Uint8Array> {
  return new TextEncoder().encode(JSON.stringify(recipe));
}
