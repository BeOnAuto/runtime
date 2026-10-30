import { Array, Effect } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { seriesRowsIn, type SeriesRows } from '../files/series-rows.ts';
import type { WalkAnswer } from '../model-processes/model-processes.ts';
import { scaleOf } from '../scoring/baselines.ts';
import { answeredWhole } from '../scoring/quantile-order.ts';
import { featureNamesOf } from '../scoring/scoring-inputs.ts';
import type { ShadowRows } from './shadow-rows.ts';
import type { ShadowOrigin } from './shadow-schedule.ts';
import { shadowGridOf } from './shadow-walk.ts';

interface WalkedSeries {
  readonly series: string;
  readonly q: readonly number[];
  readonly scale: number | null;
}

export interface PredictionsText {
  readonly text: string;
  readonly count: number;
  readonly missing: number;
}

export function predictionsText(
  document: PredictionFunctionDefinitionDocument,
  origin: ShadowOrigin,
  rows: ShadowRows,
  answer: WalkAnswer | undefined,
): Effect.Effect<PredictionsText> {
  const grid = shadowGridOf(document, rows);
  return Effect.map(
    Effect.promise(() => seriesRowsIn(rows.path, { features: featureNamesOf(document).length })),
    (parsed) => {
      const walked: readonly WalkedSeries[] =
        answer === undefined
          ? []
          : Array.zipWith(parsed, answer.q, ({ series: name, values }: SeriesRows, q: Readonly<Float32Array>) => ({
              series: name,
              q: [...q],
              scale: scaleOf(grid, values) ?? null,
            }));
      const series = walked.filter(({ q }) => answeredWhole(q));
      return {
        text: JSON.stringify({ origin: origin.form, series }),
        count: series.length,
        missing: walked.length - series.length,
      };
    },
  );
}
