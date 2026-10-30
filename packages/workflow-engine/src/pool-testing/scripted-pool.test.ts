import { describe, expect, it } from 'vitest';

import type { CheckRequest, FoldRequest, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { remoteEvaluations } from '../jobs/remote-evaluations.ts';
import { scriptedPool } from './scripted-pool.ts';
import { moduleOfSource } from './source-modules.ts';

const asked: string[] = [];

const evaluations = remoteEvaluations(
  {
    ready: () => Promise.resolve(),
    call: () => ({ ran: 'answered', text: 'null', work: 0 }),
    release: (unit) => {
      asked.push(`release ${unit}`);
    },
  },
  {
    ready: () => Promise.resolve(),
    prepare: () => Promise.resolve({ ran: 'answered', text: 'null', work: 0 }),
    test: () => Promise.resolve({ ran: 'answered', text: 'null', work: 0 }),
    release: (unit) => {
      asked.push(`release ${unit}`);
    },
  },
  () => 0,
);

const otherwise: ProgramPool = {
  workers: 3,
  heapMegabytes: 32,
  run: (request) => {
    asked.push(`run ${request.source}`);
    return Promise.resolve({ ran: 'oversized', work: 0, milliseconds: 1 });
  },
  fold: () => {
    asked.push('fold');
    return Promise.resolve({ ran: 'unreadable', milliseconds: 1 });
  },
  check: () => {
    asked.push('check');
    return Promise.resolve({ ran: 'checked', issues: [], milliseconds: 1 });
  },
  evaluations,
  close: () => {
    asked.push('close');
    return Promise.resolve();
  },
};

const request: ProgramRequest = {
  source: '.',
  entry: 'default',
  arguments: [null],
  moment: 0,
  budget: 1,
  memoryBytes: 1,
  stackBytes: 1,
  deadlineMs: 1,
  mostOutputBytes: 1,
};

const checked: CheckRequest = { schemas: {}, expressions: [], deadlineMs: 1, worker: moduleOfSource('') };

const page: FoldRequest = {
  events: [],
  views: [],
  budget: 1,
  memoryBytes: 1,
  stackBytes: 1,
  foldDeadlineMs: 1,
  pageBudgetMs: 1,
  mostViewBytes: 1,
  waitMs: 1,
  deadlineMs: 1,
};

describe('a scripted pool', () => {
  it('answers runs with the outcomes of its script in turn, then hands them, its folds, its checks, its evaluations and its closing to the pool it wraps', async () => {
    const pool = scriptedPool(
      [
        { ran: 'stopped', because: 'busy', milliseconds: 10 },
        { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      ],
      otherwise,
    );

    const ran = [await pool.run(request), await pool.run(request), await pool.run(request)];
    await pool.fold(page);
    await pool.check(checked);
    await pool.close();

    expect([pool.workers, pool.heapMegabytes, pool.evaluations]).toEqual([3, 32, evaluations]);
    expect(ran).toEqual([
      { ran: 'stopped', because: 'busy', milliseconds: 10 },
      { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      { ran: 'oversized', work: 0, milliseconds: 1 },
    ]);
    expect(asked).toEqual(['run .', 'fold', 'check', 'close']);
  });
});
