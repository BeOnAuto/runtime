import type { ProgramPool, ProgramRequest } from '@on.auto/workflow-engine/dsl';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith } from '../testing/recall-runs.ts';

const succeeded = 'language: typescript\nsource:\n  events:\n    - type: run_succeeded';

const counting = foldOf('return view;', 'return view.spring.length;');

function recording(pool: ProgramPool): { readonly pool: ProgramPool; readonly requests: ProgramRequest[] } {
  const requests: ProgramRequest[] = [];
  return {
    requests,
    pool: {
      ...pool,
      run: (request, signal) => {
        requests.push(request);
        return pool.run(request, signal);
      },
    },
  };
}

describe('the worker an answer runs in', () => {
  it('is the checked worker for every answer, with the output schema as its context, or null when there is none', async () => {
    const { pool, requests } = recording(poolOf());
    const run = recallWith(pool);
    run.keep(liveView({ spring: [1, 2] }));
    const withoutASchema = recallDocument(counting, succeeded);
    const withASchema = recallDocument(counting, `${succeeded}\noutput:\n  schema: {type: integer}`);

    const answered = [await run.running(withoutASchema), await run.running(withASchema)];

    expect(answered).toMatchObject([Exit.succeed({ output: 2 }), Exit.succeed({ output: 2 })]);
    expect(requests.map(({ worker, context }) => ({ worker: worker?.().pathname.split('/').at(-1), context }))).toEqual(
      [
        { worker: 'checked-worker.ts', context: null },
        { worker: 'checked-worker.ts', context: { type: 'integer' } },
      ],
    );
  });
});
