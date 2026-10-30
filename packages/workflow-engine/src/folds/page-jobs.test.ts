import { describe, expect, it } from 'vitest';

import { foldPageData } from '../dsl.ts';
import { foldJobOf } from '../jobs/fold-job.ts';
import { stopped } from '../jobs/job-endings.ts';
import type { Evaluate } from '../jobs/pool-job.ts';
import { moduleOfSource } from '../pool-testing/source-modules.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';

const page = {
  events: [{ type: 'noted', data: 2 }],
  views: [
    {
      fold: 'export function fold(view, event) {\n  return view + event.data;\n}',
      filters: [{ type: 'noted' }],
      view: 1,
      events: [0],
    },
  ],
  budget: 500,
  memoryBytes: unitMemoryBytes,
  stackBytes: threadStackBytes,
  foldDeadlineMs: 10_000,
  pageBudgetMs: 2000,
  mostViewBytes: 1000,
};

const aSharedBuffer: unknown = expect.any(SharedArrayBuffer);

describe('the job of a page of folds, as foldPageData of the dsl entry makes it', () => {
  it('is the job the pool hands its fold worker of a request, its wait, deadline and worker left out, so a shell makes the same', async () => {
    const handed: unknown[] = [];
    const evaluate: Evaluate = (job) => {
      handed.push(job.envelope(1));
      return Promise.resolve(stopped('closing'));
    };

    const request = { ...page, waitMs: 1, deadlineMs: 1, worker: moduleOfSource('') };

    await foldJobOf(new URL('data:text/javascript,'), evaluate, request).run();

    expect(handed).toEqual([{ job: 1, kind: 'fold', request: foldPageData(request), progress: aSharedBuffer }]);
    expect(foldPageData(request)).toEqual(foldPageData(page));
    expect(foldPageData(page)).toMatchObject({
      events: '[{"type":"noted","data":2}]',
      views: [{ view: '1', events: [0] }],
    });
  });
});
