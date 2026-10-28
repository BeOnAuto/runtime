import { processPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { Evaluation } from '../src/document/prediction-document.ts';
import { seriesRowsIn } from '../src/files/series-rows.ts';
import { modelProcesses, type ModelProcesses } from '../src/model-processes/model-processes.ts';
import { baselineWalks } from '../src/scoring/baselines.ts';
import { verdictOf } from '../src/scoring/candidate-scoring.ts';
import { scoringGridOf } from '../src/scoring/scoring-grid.ts';
import { gradeOf } from '../src/shadow/shadow-grades.ts';
import { daysMeasured, widestFeatures, type MeasuredFiles } from './model-files.ts';

const mebibyte = 1_048_576;

export interface Timed {
  readonly coldCheckMs: number;
  readonly coldRunMs: number;
  readonly warmRunMs: number;
  readonly walksMs: readonly number[];
  readonly verdictMs: number;
  readonly shadowWalkMs: number;
  readonly gradeMs: number;
}

const question = { y: Float32Array.of(10, 12, 11), x: null, given: null, h: null, features: 0, givens: 0 };

const evaluation: Evaluation = {
  holdout: 8,
  metric: 'mase',
  coverageFloor: 0.7,
  baselines: ['persistence'],
  confidence: 0.9,
  shadowPeriods: 0,
  activate: 'automatic',
};

const candidates = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

function millisecondsOf(started: number): number {
  return performance.now() - started;
}

function walkedInTurn(models: ModelProcesses, files: MeasuredFiles): Promise<readonly number[]> {
  const walk = {
    rows: files.rows,
    window: daysMeasured,
    holdout: 8,
    steps: 2,
    features: 0,
    given: [],
    remaining: null,
  };
  return candidates.reduce<Promise<readonly number[]>>(async (before, candidate) => {
    const done = await before;
    const started = performance.now();
    const outcome = await Effect.runPromise(models.walk(files.runtime, { sha256: candidate, path: files.mean }, walk));
    if (outcome.ended !== 'answered') {
      throw new Error(`The walk of ${candidate} ended ${outcome.ended}`);
    }
    return [...done, millisecondsOf(started)];
  }, Promise.resolve([]));
}

async function scoredOnce(models: ModelProcesses, files: MeasuredFiles): Promise<number> {
  const walk = {
    rows: files.rows,
    window: daysMeasured,
    holdout: 8,
    steps: 2,
    features: 0,
    given: [],
    remaining: null,
  };
  const outcome = await Effect.runPromise(models.walk(files.runtime, { sha256: 'scored', path: files.mean }, walk));
  if (outcome.ended !== 'answered') {
    throw new Error(`The walk ended ${outcome.ended}`);
  }
  const started = performance.now();
  const rows = await seriesRowsIn(files.rows, { features: 0 });
  const grid = scoringGridOf(
    { period: 'day', horizons: [1, 2] },
    { window: daysMeasured, holdout: 8, firstPeriod: '2026-03-01' },
  );
  const scoring = { grid, rows, evaluation, seed: 1 };
  verdictOf(scoring, baselineWalks(scoring), outcome.answer);
  return millisecondsOf(started);
}

async function gradedOnce(files: MeasuredFiles): Promise<number> {
  const rows = await seriesRowsIn(files.rows, { features: 0 });
  const started = performance.now();
  const predictions = {
    origin: '2026-09-16',
    series: rows.map(({ series }) => ({ series, q: [9, 11, 13, 9, 11, 13], scale: 1 })),
  };
  const truths = new Map(rows.map(({ series }) => [series, 11]));
  gradeOf([{ predictions, horizon: 1 }], [{ predictions, horizon: 1 }], { truths, absentIsZero: true });
  return millisecondsOf(started);
}

export async function modelTimings(files: MeasuredFiles): Promise<Timed> {
  const pool = processPool({ processes: 4, longJobs: 2, memoryBytes: 1280 * mebibyte, path: process.env['PATH'] });
  const models = modelProcesses({ pool });
  const mean = { sha256: 'mean', path: files.mean };
  const checked = performance.now();
  await Effect.runPromise(
    models.check(
      files.runtime,
      { sha256: 'cold', path: files.mean },
      { features: 0, given: 0, horizon: 2, totals: false },
    ),
  );
  const coldCheckMs = millisecondsOf(checked);
  const ranCold = performance.now();
  await Effect.runPromise(models.run(files.runtime, mean, question));
  const coldRunMs = millisecondsOf(ranCold);
  const ranWarm = performance.now();
  await Effect.runPromise(models.run(files.runtime, mean, question));
  const warmRunMs = millisecondsOf(ranWarm);
  const walksMs = await walkedInTurn(models, files);
  const verdictMs = await scoredOnce(models, files);
  const shadowed = performance.now();
  await Effect.runPromise(
    models.walk(files.runtime, mean, {
      rows: files.rows,
      window: daysMeasured,
      holdout: 1,
      steps: 2,
      features: 0,
      given: [],
      remaining: null,
    }),
  );
  const shadowWalkMs = millisecondsOf(shadowed);
  const gradeMs = await gradedOnce(files);
  await pool.close();
  return { coldCheckMs, coldRunMs, warmRunMs, walksMs, verdictMs, shadowWalkMs, gradeMs };
}

export interface QuestionTimed {
  readonly windowMs: number;
  readonly runMs: number;
  readonly heapGrowth: number;
}

export async function questionTimings(files: MeasuredFiles): Promise<QuestionTimed> {
  const pool = processPool({ processes: 4, longJobs: 2, memoryBytes: 1280 * mebibyte, path: process.env['PATH'] });
  const models = modelProcesses({ pool });
  const heapBefore = process.memoryUsage().heapUsed;
  const read = performance.now();
  const window = await Effect.runPromise(
    models.window(
      { sha256: 'widest', path: files.widest },
      { series: 'store-0500', features: widestFeatures, grain: 'day', window: daysMeasured },
    ),
  );
  const windowMs = millisecondsOf(read);
  if (window.ended !== 'answered' || 'unknown' in window.answer) {
    throw new Error(`The window was not read: ${window.ended}`);
  }
  const { y } = window.answer;
  await Effect.runPromise(
    models.run(
      files.runtime,
      { sha256: 'mean', path: files.mean },
      { y: Float32Array.from(y), x: null, given: null, h: null, features: 0, givens: 0 },
    ),
  );
  const runMs = millisecondsOf(read);
  const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
  await pool.close();
  return { windowMs, runMs, heapGrowth };
}

export interface BaselineCheckTimed {
  readonly checkMs: number;
  readonly perfect: string | null;
  readonly heapGrowth: number;
}

export async function baselineCheckTimings(files: MeasuredFiles): Promise<BaselineCheckTimed> {
  const pool = processPool({ processes: 4, longJobs: 2, memoryBytes: 1280 * mebibyte, path: process.env['PATH'] });
  const models = modelProcesses({ pool });
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const checked = await Effect.runPromise(
    models.baselines(
      { sha256: 'widest', path: files.widest },
      {
        period: 'day',
        horizons: [1, 2],
        accumulates: null,
        season: 7,
        window: daysMeasured,
        holdout: 8,
        firstPeriod: '2026-03-01',
        baselines: ['persistence', 'seasonal-naive'],
        metric: 'mase',
      },
    ),
  );
  const checkMs = millisecondsOf(started);
  const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
  await pool.close();
  if (checked.ended !== 'answered') {
    throw new Error(`The check of the baselines ended ${checked.ended}`);
  }
  return { checkMs, perfect: checked.answer.perfect, heapGrowth };
}
