import { describe, expect, it } from 'vitest';

import * as evaluationWorker from './evaluation-worker.ts';
import * as foldWorker from './fold-worker.ts';
import * as programWorker from './program-worker.ts';

describe('the worker modules of the pool, loaded on the thread of a test', () => {
  it('load without failing, serve nothing and export nothing', () => {
    expect([Object.keys(programWorker), Object.keys(foldWorker), Object.keys(evaluationWorker)]).toEqual([[], [], []]);
  });
});
