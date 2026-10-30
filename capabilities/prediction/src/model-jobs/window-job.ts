import { seriesRowsIn, type SeriesRows } from '../files/series-rows.ts';
import { periodOfForm } from '../periods/grains.ts';
import type { WindowJob } from './model-feeds.ts';

export type SeriesWindowAnswer =
  | { readonly unknown: true }
  | { readonly y: Float64Array; readonly x: Float32Array | null; readonly origin: number };

function cellAt(index: number | undefined, value: (position: number) => number): number {
  return index === undefined ? Number.NaN : value(index);
}

function windowOf(found: SeriesRows, job: WindowJob, last: number): SeriesWindowAnswer {
  const at = new Map(found.periods.map((form, index) => [Number(periodOfForm(job.grain, form)), index]));
  const positions = Array.from({ length: job.window }, (_, offset) => at.get(last - job.window + 1 + offset));
  return {
    y: Float64Array.from(positions, (index) => cellAt(index, (position) => Number(found.values[position]))),
    x:
      job.features === 0
        ? null
        : Float32Array.from(
            positions.flatMap((index) =>
              Array.from({ length: job.features }, (_, column) =>
                cellAt(index, (position) => Number(found.features[position * job.features + column])),
              ),
            ),
          ),
    origin: last,
  };
}

export async function seriesWindowIn(job: WindowJob): Promise<SeriesWindowAnswer> {
  const last = { period: Number.NEGATIVE_INFINITY };
  const [found] = await seriesRowsIn(job.rows, {
    features: job.features,
    keeps: (series) => series === job.series,
    sees: (form) => {
      last.period = Math.max(last.period, Number(periodOfForm(job.grain, form)));
    },
  });
  return found === undefined ? { unknown: true } : windowOf(found, job, last.period);
}
