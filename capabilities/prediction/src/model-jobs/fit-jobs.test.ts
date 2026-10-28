import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TrainingRows } from '@on.auto/prediction-contract';
import type { ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { describe, expect, it } from 'vitest';

import { periodOfForm } from '../periods/grains.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { modelJobs } from './model-jobs.ts';
import { importedRuntime, type RuntimeFitters } from './runtime-modules.ts';

const runtime = scriptedRuntime.binding.module().href;

const shape = {
  fed: { features: 0, given: 0, horizon: 2, totals: false },
  grain: 'day',
  season: null,
  accumulates: null,
  holdout: 8,
};

function asked(kind: string, payload: ProcessValue, jobs = modelJobs()) {
  const handler = jobs[kind];
  return Promise.resolve(handler === undefined ? null : handler(payload));
}

function rowsFileOf(text: string): string {
  const path = join(scratchDirectory(), 'training.csv');
  writeFileSync(path, text);
  return path;
}

const training = ['series,period,visits', 'north,2026-10-01,10', 'north,2026-10-02,12', 'north,2026-10-03,14'].join(
  '\r\n',
);

function fittingAndSeeing(): { readonly jobs: ReturnType<typeof modelJobs>; readonly seen: TrainingRows[] } {
  const seen: TrainingRows[] = [];
  const fitters: RuntimeFitters = () =>
    Promise.resolve({
      fitModels: (_shape, rows) => {
        seen.push(rows);
        return Promise.resolve([{ format: 'scripted', bytes: Uint8Array.of(1, 2) }]);
      },
      defaultModel: () => ({ format: 'scripted', bytes: Uint8Array.of(3) }),
    });
  return { jobs: modelJobs({ loaders: importedRuntime, fitters }), seen };
}

describe('the models a runtime fits itself in a model process', () => {
  it('are fitted from the target of each series of the training rows, from the index of their first period', async () => {
    const { jobs, seen } = fittingAndSeeing();

    expect(await asked('fit', { runtime, rows: rowsFileOf(training), shape, threads: 1 }, jobs)).toEqual({
      models: [{ format: 'scripted', bytes: Uint8Array.of(1, 2) }],
    });
    expect(seen).toEqual([{ first: periodOfForm('day', '2026-10-01'), series: [Float64Array.of(10, 12, 14)] }]);
  });

  it('are fitted from no series of training rows that hold none, and answer the default model of a function', async () => {
    const { jobs, seen } = fittingAndSeeing();

    await asked('fit', { runtime, rows: rowsFileOf('series,period,visits\r\n'), shape, threads: 1 }, jobs);

    expect(seen).toEqual([{ first: 0, series: [] }]);
    expect(await asked('default', { runtime, shape, threads: 1 }, jobs)).toEqual({
      format: 'scripted',
      bytes: Uint8Array.of(3),
    });
  });

  it('are the scripted runtime’s own, imported from its module', async () => {
    expect(await asked('fit', { runtime, rows: rowsFileOf(training), shape, threads: 1 })).toMatchObject({
      models: [{ format: 'scripted' }, { format: 'scripted' }],
    });
    expect(await asked('default', { runtime, shape, threads: 1 })).toMatchObject({ format: 'scripted' });
  });
});
