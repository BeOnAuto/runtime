import { Conflict } from '@on.auto/operations';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith } from '../testing/recall-runs.ts';

const wholeView = recallDocument(foldOf('return view;'));
const refusal = new Conflict({ detail: 'There are not enough credits', kind: 'unworkable' });

function recordedPool() {
  const pool = poolOf();
  const calls: string[] = [];
  const recording: ProgramPool = {
    ...pool,
    run: (request, signal) => {
      calls.push('sandbox');
      return pool.run(request, signal);
    },
  };
  return { pool: recording, calls };
}

describe('recall dispatch admission', () => {
  it('requires admission before it runs its answer in the sandbox', async () => {
    const { pool, calls } = recordedPool();
    const run = recallWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );
    run.keep(liveView({}));

    expect(await run.running(campaignReviews, { campaign: 'spring' })).toMatchObject(Exit.succeed({ output: [] }));
    expect(calls).toEqual(['admission', 'sandbox']);
  });

  it('also requires admission before returning a view without an answer program', async () => {
    const { pool, calls } = recordedPool();
    const run = recallWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );
    run.keep(liveView({ count: 3 }));

    expect(await run.running(wholeView)).toMatchObject(Exit.succeed({ output: { count: 3 } }));
    expect(calls).toEqual(['admission']);
  });

  it.each([wholeView, campaignReviews])('does not answer or start work if admission is refused', async (source) => {
    const { pool, calls } = recordedPool();
    const run = recallWith(pool, {}, () => Effect.fail(refusal));
    run.keep(liveView({}));

    expect(await run.running(source, { campaign: 'spring' })).toEqual(Exit.fail(refusal));
    expect(calls).toEqual([]);
  });
});

describe('recall preflight before admission', () => {
  it('does not request admission for invalid input or an unavailable view', async () => {
    const { pool, calls } = recordedPool();
    const run = recallWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );

    expect(await run.running(campaignReviews, {})).toMatchObject(Exit.fail({ kind: 'input_schema' }));
    expect(await run.running(campaignReviews, { campaign: 'spring' })).toMatchObject(Exit.fail({ kind: 'rebuilding' }));
    run.keep(liveView({}, { phase: 'rebuilding' }));
    expect(await run.running(campaignReviews, { campaign: 'spring' })).toMatchObject(Exit.fail({ kind: 'rebuilding' }));
    expect(calls).toEqual([]);
  });

  it('does not request admission when its answer program has not been compiled', async () => {
    const { pool, calls } = recordedPool();
    const run = recallWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );
    run.keep(liveView({}));

    expect(await run.runningUnsaved(campaignReviews, { campaign: 'spring' })).toMatchObject(
      Exit.fail({ kind: 'unworkable' }),
    );
    expect(calls).toEqual([]);
  });
});
