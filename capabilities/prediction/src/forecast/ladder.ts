import { backtestOf, isBacktestedEnough, type Backtest } from './backtest.ts';
import { historyOf, isNeverNegative, type History } from './history.ts';
import { aheadOf, lowestMethodOf, seasonalMethodsOf, type Asked, type Method, type MethodName } from './methods.ts';
import { rangeAround, type Point } from './quantiles.ts';

export interface ForecastQuestion {
  readonly observed: readonly (number | null)[];
  readonly season: number | null;
  readonly coverage: number;
  readonly asked: Asked;
}

export interface Forecast {
  readonly method: MethodName;
  readonly coverage: number;
  readonly season: number | null;
  readonly k?: number;
  readonly history: { readonly periods: number; readonly origins: number };
  readonly points: readonly Point[];
}

export interface HistoryTooShort {
  readonly refused: 'history_too_short';
  readonly have: number;
}

function answerOf(
  history: History,
  method: Method,
  { origins, misses }: Backtest,
  question: ForecastQuestion,
): Forecast {
  const { coverage, asked } = question;
  const rule = { coverage, neverNegative: isNeverNegative(history) };
  const forecasts = method.forecastAt(history, history.origin, aheadOf(asked));
  return {
    method: method.name,
    coverage,
    season: method.season,
    ...(method.k === null ? {} : { k: method.k }),
    history: { periods: history.periods, origins },
    points: misses.map((slot, at) => rangeAround(Number(forecasts[at]), slot, rule)),
  };
}

export function forecastOf(question: ForecastQuestion): Forecast | HistoryTooShort {
  const { observed, season, asked } = question;
  const history = historyOf(observed);
  for (const method of [...seasonalMethodsOf(season, asked), lowestMethodOf(asked)]) {
    const backtest = backtestOf(history, method, asked);
    if (isBacktestedEnough(backtest)) {
      return answerOf(history, method, backtest, question);
    }
  }
  return { refused: 'history_too_short', have: history.periods };
}
