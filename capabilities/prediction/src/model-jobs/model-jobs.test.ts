import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LoadedModel, LoadModel } from '@on.auto/prediction-contract';
import type { ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { describe, expect, it } from 'vitest';

import { periodOfForm } from '../periods/grains.ts';
import { candidateFile } from '../runtime-testing/scripted-candidates.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { modelJobs } from './model-jobs.ts';

const runtime = scriptedRuntime.binding.module().href;

function asked(kind: string, payload: ProcessValue, jobs = modelJobs()) {
  const handler = jobs[kind];
  return Promise.resolve(handler === undefined ? null : handler(payload));
}

const visits = ['series,period,visits', 'north,2026-10-01,10', 'north,2026-10-02,12', 'north,2026-10-03,14'].join(
  '\r\n',
);

function rowsFile(): string {
  const path = join(scratchDirectory(), 'scoring.csv');
  writeFileSync(path, visits);
  return path;
}

function countingLoads(model: LoadedModel | string): {
  readonly jobs: ReturnType<typeof modelJobs>;
  readonly loads: () => number;
} {
  const counted = { loads: 0 };
  const load: LoadModel = () => {
    counted.loads += 1;
    return typeof model === 'string' ? Promise.reject(new Error(model)) : Promise.resolve(model);
  };
  return { jobs: modelJobs(() => Promise.resolve(load)), loads: () => counted.loads };
}

const fed = { features: 0, given: 0, horizon: 2, totals: false };

const notParsed: unknown = expect.stringMatching(/JSON/u);

const throwing: LoadedModel = {
  signature: {},
  length: undefined,
  issueFor: () => null,
  run: () => Promise.reject(new Error('The session was closed')),
};

describe('the check of a model file in its process', () => {
  it('answers the signature its runtime gives and the issue it finds with what the function feeds, or why a file did not load', async () => {
    const check = { runtime, threads: 1, fed };

    expect(await asked('check', { ...check, model: candidateFile('visits-mean') })).toEqual({
      loaded: true,
      signature: { recipe: 'mean', steps: 2, low: 2, high: 2, features: 0, given: 0, totals: false },
      issue: null,
    });
    expect(await asked('check', { ...check, model: candidateFile('visits-extra-input') })).toMatchObject({
      loaded: true,
      issue: 'The recipe takes the inputs extra, which the playbook does not feed',
    });
    expect(await asked('check', { ...check, model: candidateFile('not-a-model') })).toMatchObject({
      loaded: false,
      detail: notParsed,
    });
  });
});

const question = { runtime, threads: 1, y: Float32Array.of(1), x: null, given: null, h: null, features: 0, givens: 0 };

describe('a question run in a model process', () => {
  it('answers q and its dimensions', async () => {
    const answer = await asked('run', {
      runtime,
      model: candidateFile('visits-mean'),
      threads: 1,
      y: Float32Array.of(10, 12),
      x: null,
      given: null,
      h: null,
      features: 0,
      givens: 0,
    });

    expect(answer).toEqual({ q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] });
  });

  it('answers badly for a model whose runtime says it answered badly, and fails for what else goes wrong', async () => {
    expect(await asked('run', { ...question, model: candidateFile('visits-whole-numbers') })).toEqual({
      badly: 'The recipe answers whole numbers, not a q of float32',
    });
    await expect(asked('run', { ...question, model: 'closing' }, countingLoads(throwing).jobs)).rejects.toThrow(
      'The session was closed',
    );
  });
});

describe('a question run in a model process that answers no finite number', () => {
  it('fails, so that its process is let go, for a model that answers a number that is not finite', async () => {
    const answeringNaN: LoadedModel = {
      ...throwing,
      run: () => Promise.resolve({ q: Float32Array.of(9, Number.NaN, 13), dims: [1, 1, 3] }),
    };

    const failed = await asked('run', { ...question, model: 'nan' }, countingLoads(answeringNaN).jobs).catch(String);

    expect(failed).toBe('The model answered a number that is not finite');
  });
});

describe('the window of a series read in a model process', () => {
  it('reads the periods of the series asked up to the last period of the whole file, NaN where it has none', async () => {
    const path = join(scratchDirectory(), 'upload.csv');
    writeFileSync(
      path,
      [
        'series,period,visits,promotion',
        'north,2026-10-01,10,1',
        'north,2026-10-03,14,0',
        'south,2026-10-04,20,1',
      ].join('\r\n'),
    );
    const window = { rows: path, features: 1, grain: 'day', window: 4, threads: 1 };

    expect([
      await asked('window', { ...window, series: 'north' }),
      await asked('window', { ...window, series: 'east' }),
    ]).toEqual([
      {
        y: Float64Array.of(10, Number.NaN, 14, Number.NaN),
        x: Float32Array.of(1, Number.NaN, 0, Number.NaN),
        origin: periodOfForm('day', '2026-10-04'),
      },
      { unknown: true },
    ]);
    expect(await asked('window', { ...window, features: 0, series: 'south' })).toMatchObject({ x: null });
  });
});

const walking = {
  runtime,
  threads: 1,
  window: 3,
  holdout: 1,
  steps: 2,
  features: 0,
  given: [],
  remaining: null,
};

describe('a walk in a model process', () => {
  it('answers the q of each held-back origin of each series in the rows file', async () => {
    const answer = await asked('walk', { ...walking, rows: rowsFile(), model: candidateFile('visits-mean') });

    expect(answer).toEqual({ series: ['north'], q: [Float32Array.of(10, 12, 14, 10, 12, 14)] });
  });

  it('answers badly for a model whose runtime says it answered badly', async () => {
    expect(await asked('walk', { ...walking, rows: rowsFile(), model: candidateFile('visits-whole-numbers') })).toEqual(
      {
        badly: 'The recipe answers whole numbers, not a q of float32',
      },
    );
  });
});

describe('the sessions a model process keeps', () => {
  it('load a file once for every job on it, and load it again after a load that failed', async () => {
    const loaded = countingLoads(throwing);
    const failing = countingLoads('No such file');
    const check = { runtime, threads: 1, fed };

    await asked('check', { ...check, model: 'same' }, loaded.jobs);
    await asked('check', { ...check, model: 'same' }, loaded.jobs);
    const first = await asked('check', { ...check, model: 'gone' }, failing.jobs);
    await asked('check', { ...check, model: 'gone' }, failing.jobs);

    expect([loaded.loads(), failing.loads(), first]).toEqual([1, 2, { loaded: false, detail: 'No such file' }]);
  });
});

function scoringRows(values: readonly number[]): string {
  const path = join(scratchDirectory(), 'perfect.csv');
  const days = values.map((value, day) => `north,2026-10-${String(day + 1).padStart(2, '0')},${value},1`);
  writeFileSync(path, ['series,period,visits,promotion', ...days].join('\r\n'));
  return path;
}

const perfectJob = {
  period: 'day',
  horizons: [1],
  accumulates: null,
  season: null,
  window: 12,
  holdout: 4,
  firstPeriod: '2026-10-01',
  baselines: ['persistence'],
  metric: 'mase',
  threads: 1,
};

describe('the check of the baselines of a build in a model process', () => {
  it('names a baseline that loses nothing where its metric scores it, and none that misses a period or scores nothing', async () => {
    const moving = [1, 2, 3, 2, 3, 4, 3, 4];

    expect([
      await asked('baselines', { ...perfectJob, rows: scoringRows([...moving, 5, 5, 5, 5]) }),
      await asked('baselines', { ...perfectJob, rows: scoringRows([...moving, 5, 5, 6, 6]) }),
      await asked('baselines', { ...perfectJob, rows: scoringRows([5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 7, 8]) }),
      await asked('baselines', {
        ...perfectJob,
        accumulates: 'week',
        season: 7,
        horizons: [],
        rows: scoringRows([...moving, 5, 5, 6, 6]),
      }),
    ]).toEqual([
      { perfect: 'persistence', unscorable: false },
      { perfect: null, unscorable: false },
      { perfect: null, unscorable: true },
      { perfect: null, unscorable: false },
    ]);
  });

  it('calls a build unscorable when mase judges no period held back that a baseline walks, since no series moved while trained', async () => {
    const stillWhileTrained = scoringRows([5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 7, 8]);
    const nothingHeldBack = scoringRows([5, 5, 5, 5, 5, 5, 5, 5, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);

    expect([
      await asked('baselines', { ...perfectJob, rows: stillWhileTrained }),
      await asked('baselines', { ...perfectJob, metric: 'winkler', rows: stillWhileTrained }),
      await asked('baselines', { ...perfectJob, rows: nothingHeldBack }),
    ]).toEqual([
      { perfect: null, unscorable: true },
      { perfect: null, unscorable: false },
      { perfect: null, unscorable: false },
    ]);
  });
});
