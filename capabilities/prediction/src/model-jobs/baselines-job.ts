import { seriesRowsIn } from '../files/series-rows.ts';
import { baselineWalk, scaleOf } from '../scoring/baselines.ts';
import { judgesNoPeriodHeldBack, losesNothing } from '../scoring/metrics.ts';
import { scoringGridOf } from '../scoring/scoring-grid.ts';
import type { BaselinesJob } from './model-feeds.ts';

export interface BaselinesAnswer {
  readonly perfect: BaselinesJob['baselines'][number] | null;
  readonly unscorable: boolean;
}

export async function perfectBaselineIn(job: BaselinesJob): Promise<BaselinesAnswer> {
  const { period, horizons, accumulates, season, window, holdout, firstPeriod, metric } = job;
  const rows = await seriesRowsIn(job.rows, { features: 0 });
  const grid = scoringGridOf(
    {
      period,
      horizons,
      ...(accumulates === null ? {} : { accumulates }),
      ...(season === null ? {} : { season }),
    },
    { window, holdout, firstPeriod },
  );
  const walks = job.baselines.map((baseline) => baselineWalk({ grid, rows }, baseline));
  const perfect = walks.find(({ forecasts }) => losesNothing(grid, forecasts, metric));
  const scaled = rows.map(({ values }) => ({ values, scale: scaleOf(grid, values) }));
  return {
    perfect: perfect?.baseline ?? null,
    unscorable: judgesNoPeriodHeldBack(grid, scaled, metric) && walks.some(({ scored }) => scored.seriesWalked > 0),
  };
}
