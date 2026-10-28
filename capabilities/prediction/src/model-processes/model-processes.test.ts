import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { scriptedModels } from '../build-testing/scripted-models.ts';
import { candidateFile, type CandidateName } from '../runtime-testing/scripted-candidates.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { closedAfterTheTest, scratchDirectory } from '../testing/scratch.ts';
import { modelDeadlines, modelProcesses, modelProcessModule, threadsOf } from './model-processes.ts';

function fileOf(name: CandidateName) {
  return { sha256: name, path: candidateFile(name) };
}

const question = { y: Float32Array.of(10, 12), x: null, given: null, h: null, at: null, features: 0, givens: 0 };

function rowsFile(): string {
  const path = join(scratchDirectory(), 'scoring.csv');
  writeFileSync(path, ['series,period,visits', 'north,2026-10-01,10', 'north,2026-10-02,12'].join('\r\n'));
  return path;
}

const walk = { window: 2, holdout: 1, steps: 2, features: 0, given: [], remaining: null, first: null };

const ofAnyLength: unknown = expect.any(Number);

const fed = { features: 0, given: 0, horizon: 2, totals: false };

describe('the model processes of a server', () => {
  it('check a file, answer a question and walk the held-back origins in the process that holds the model', async () => {
    const models = modelProcesses({ pool: closedAfterTheTest(3) });
    const mean = fileOf('visits-mean');

    const checked = await Effect.runPromise(models.check(scriptedRuntime, mean, fed));
    const answered = await Effect.runPromise(models.run(scriptedRuntime, mean, question));
    const walked = await Effect.runPromise(models.walk(scriptedRuntime, mean, { ...walk, rows: rowsFile() }));

    expect(checked).toMatchObject({
      ended: 'answered',
      answer: { loaded: true, signature: { recipe: 'mean' }, issue: null },
      milliseconds: ofAnyLength,
    });
    expect(answered).toMatchObject({
      ended: 'answered',
      answer: { q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] },
    });
    expect(walked).toMatchObject({
      ended: 'answered',
      answer: { series: ['north'], q: [Float32Array.of(9, 11, 13, 9, 11, 13)] },
    });
  });

  it('end a job past its deadline, which is by default 30 s for a check, 10 s for a question and 10 minutes for a walk', async () => {
    const models = modelProcesses({
      pool: closedAfterTheTest(3),
      deadlines: { check: 1, run: 1, walk: 1, baselines: 30_000, fit: 30_000 },
    });

    expect(await Effect.runPromise(models.check(scriptedRuntime, fileOf('visits-mean'), fed))).toMatchObject({
      ended: 'timed_out',
    });
    expect(modelDeadlines).toEqual({ check: 30_000, run: 10_000, walk: 600_000, baselines: 30_000, fit: 30_000 });
  });
});

describe('a model process that fails', () => {
  it('ends its job as crashed when it exits, out of memory when it runs out, crashed when it answers what no model process does, and badly as it says', async () => {
    const scripted = scriptedModels();
    const models = modelProcesses({ pool: closedAfterTheTest(3), module: scripted.module });
    const mean = fileOf('visits-mean');

    scripted.next('exits');
    const exited = await Effect.runPromise(models.run(scriptedRuntime, mean, question));
    scripted.next('allocates');
    const exhausted = await Effect.runPromise(models.run(scriptedRuntime, mean, question));
    scripted.next('garbage');
    const garbage = await Effect.runPromise(models.check(scriptedRuntime, mean, fed));
    scripted.next('badly');
    const badly = await Effect.runPromise(models.walk(scriptedRuntime, mean, { ...walk, rows: rowsFile() }));

    expect([exited.ended, exhausted.ended]).toEqual(['crashed', 'out_of_memory']);
    expect(garbage).toMatchObject({
      ended: 'crashed',
      detail: 'The model process answered what a model process does not',
    });
    expect(badly).toMatchObject({ ended: 'badly', detail: 'The scripted model answered badly' });
  });
});

describe('the threads of a model process', () => {
  it('share the cores among the processes, one at least', () => {
    expect([threadsOf(4, 16), threadsOf(4, 2), threadsOf(3, 8)]).toEqual([4, 1, 2]);
  });
});

describe('the module a model process runs', () => {
  it('is named by a module that loads where import.meta.url names no file, read only as a job is made', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./model-processes.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('modelProcessModule');
    expect(modelProcessModule().pathname).toMatch(/\/model-jobs\/model-process\.ts$/u);
  });
});
