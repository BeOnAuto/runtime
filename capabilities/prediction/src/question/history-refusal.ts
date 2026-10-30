import { Conflict } from '@on.auto/operations';
import { Option } from 'effect';

import { figure } from '../capability/figures.ts';
import type { Aggregation, Predicts } from '../document/prediction-document.ts';
import { isObserved } from '../forecast/history.ts';
import type { HistoryTooShort } from '../forecast/ladder.ts';
import { stepsUpTo } from '../forecast/methods.ts';
import { periodForm, type Grain } from '../periods/grains.ts';
import type { SeriesWindow } from '../window/series-window.ts';
import { forecastAt } from './question-asked.ts';

export interface ShortSeries {
  readonly series: string;
  readonly predicts: Predicts;
  readonly as: Aggregation;
  readonly window: SeriesWindow;
}

const aValueSupposed = 0;

function windowLater(window: SeriesWindow, periods: number): SeriesWindow {
  return {
    ...window,
    observed: [...window.observed.slice(periods), ...Array.from({ length: periods }, () => aValueSupposed)],
    first: window.first + periods,
    origin: window.origin + periods,
  };
}

function periodsUntilAnswered(predicts: Predicts, window: SeriesWindow): number {
  const answered = stepsUpTo(window.observed.length).find(
    (periods) => !('refused' in forecastAt(predicts, windowLater(window, periods))),
  );
  return Option.getOrThrow(Option.fromNullishOr(answered));
}

function periodsOf(count: number): string {
  return count === 1 ? 'one period' : `${figure(count)} periods`;
}

function withoutAValue(count: number): string {
  if (count === 0) {
    return '';
  }
  return `, ${count === 1 ? 'one' : figure(count)} of them without a value`;
}

function heldWords({ observed, origin }: SeriesWindow, grain: Grain, have: number): string {
  if (have === 0) {
    return 'no observed period of history';
  }
  const unobserved = observed.slice(observed.length - have).filter((value) => !isObserved(value)).length;
  return `${periodsOf(have)} of history up to ${periodForm(grain, origin)}${withoutAValue(unobserved)}`;
}

function holdsAValueEveryPeriod(as: Aggregation): boolean {
  return as === 'count' || as === 'sum';
}

export function historyTooShort({ series, predicts, as, window }: ShortSeries, { have }: HistoryTooShort): Conflict {
  const from = periodForm(predicts.period, window.origin + periodsUntilAnswered(predicts, window) + 1);
  const condition = holdsAValueEveryPeriod(as) ? '' : ', if every period until then holds a value';
  return new Conflict({
    detail: `The series ${JSON.stringify(series)} has ${heldWords(window, predicts.period, have)}, too few for the forecaster to backtest an answer; ask again from ${from}${condition}`,
    kind: 'history_too_short',
  });
}
