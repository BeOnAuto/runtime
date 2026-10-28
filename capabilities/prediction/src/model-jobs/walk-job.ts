import type { LoadedModel } from '@on.auto/prediction-contract';

import type { SeriesRows } from '../files/series-rows.ts';
import { feedsOf, type WalkJob } from './model-feeds.ts';

export type WalkAnswer =
  | { readonly series: readonly string[]; readonly q: readonly Readonly<Float32Array>[] }
  | { readonly badly: string };

const percentiles = 3;

function slice(values: Readonly<Float64Array>, from: number, to: number, width: number): Float32Array {
  return Float32Array.from(values.subarray(from * width, to * width));
}

function givenAhead(rows: SeriesRows, walk: WalkJob, origin: number, steps: number): Float32Array | null {
  if (walk.given.length === 0) {
    return null;
  }
  const taken = new Float32Array(steps * walk.given.length).fill(Number.NaN);
  for (let step = 0; step < steps; step += 1) {
    for (const [column, feature] of walk.given.entries()) {
      taken[step * walk.given.length + column] =
        rows.features[(origin + 1 + step) * walk.features + feature] ?? Number.NaN;
    }
  }
  return taken;
}

interface Walking {
  readonly model: LoadedModel;
  readonly walk: WalkJob;
  readonly rows: SeriesRows;
}

type Answers = readonly Readonly<Float32Array>[];

async function answersFrom({ model, walk, rows }: Walking, step: number, answers: Answers): Promise<Answers | string> {
  if (step >= walk.holdout) {
    return answers;
  }
  const answered = walk.remaining === null ? walk.steps : 1;
  const origin = walk.window - walk.holdout + step;
  const remaining = walk.remaining?.[step] ?? null;
  const answer = await model.run(
    feedsOf(
      {
        y: slice(rows.values, 0, origin + 1, 1),
        x: walk.features === 0 ? null : slice(rows.features, 0, origin + 1, walk.features),
        given: givenAhead(rows, walk, origin, remaining ?? walk.steps),
        h: remaining,
        features: walk.features,
        givens: walk.given.length,
      },
      model.length,
    ),
  );
  if ('badly' in answer) {
    return answer.badly;
  }
  if (answer.dims.join(',') !== `1,${answered},${percentiles}`) {
    return `The model answered q of the shape [${answer.dims.join(', ')}] where [1, ${answered}, ${percentiles}] was expected`;
  }
  return answersFrom({ model, walk, rows }, step + 1, [...answers, answer.q]);
}

async function walkedSeries(
  model: LoadedModel,
  walk: WalkJob,
  rows: SeriesRows,
): Promise<Readonly<Float32Array> | string> {
  const answers = await answersFrom({ model, walk, rows }, 0, []);
  if (typeof answers === 'string') {
    return answers;
  }
  const width = (walk.remaining === null ? walk.steps : 1) * percentiles;
  const q = new Float32Array(walk.holdout * width);
  for (const [step, answer] of answers.entries()) {
    q.set(answer, step * width);
  }
  return q;
}

async function walkedEach(
  model: LoadedModel,
  walk: WalkJob,
  left: readonly SeriesRows[],
  done: { readonly series: readonly string[]; readonly q: readonly Readonly<Float32Array>[] },
): Promise<WalkAnswer> {
  const [rows, ...rest] = left;
  if (rows === undefined) {
    return done;
  }
  const answer = await walkedSeries(model, walk, rows);
  return typeof answer === 'string'
    ? { badly: answer }
    : walkedEach(model, walk, rest, { series: [...done.series, rows.series], q: [...done.q, answer] });
}

export function walked(model: LoadedModel, walk: WalkJob, rows: readonly SeriesRows[]): Promise<WalkAnswer> {
  return walkedEach(model, walk, rows, { series: [], q: [] });
}
