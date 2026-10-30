import type { Schema } from 'effect';

import { decimalsObserved } from '../capability/figures.ts';
import type { Predicts } from '../document/prediction-document.ts';
import { isObserved } from '../forecast/history.ts';
import type { Forecast } from '../forecast/ladder.ts';
import { enclosingOf } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import type { SeriesWindow } from '../window/series-window.ts';

function totalToOf({ period: grain, accumulates }: Predicts, origin: number): { readonly total_to?: string } {
  return accumulates === undefined
    ? {}
    : { total_to: periodForm(accumulates, enclosingOf(grain, accumulates, origin + 1)) };
}

export function questionRecordOf(
  { method, coverage, season, k, history }: Forecast,
  predicts: Predicts,
  { observed, origin, checkpoint }: SeriesWindow,
): Schema.JsonObject {
  const { period: grain } = predicts;
  return {
    method,
    coverage,
    season,
    ...(k === undefined ? {} : { k }),
    history: {
      periods: history.periods,
      first_period: periodForm(grain, origin - history.periods + 1),
      last_period: periodForm(grain, origin),
      origins: history.origins,
    },
    decimals: decimalsObserved(observed.flatMap((value) => (isObserved(value) ? [value] : []))),
    ...totalToOf(predicts, origin),
    origin: periodForm(grain, origin),
    dataset_checkpoint: checkpoint,
  };
}
