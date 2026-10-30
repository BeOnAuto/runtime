import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import type { ViewStall } from '@on.auto/workflow-host';
import { Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, recallWith } from '../testing/recall-runs.ts';

const reviews = {
  spring: [
    { at: '2026-10-06T10:00:00.000Z', verdict: 'approve', run: '/runs/a' },
    { at: '2026-10-06T10:00:03.000Z', verdict: 'reject', run: '/runs/b' },
  ],
  unknown: [{ at: '2026-10-06T10:00:01.000Z', verdict: 'none', run: '/runs/c' }],
};

const waitsToBuild: unknown = expect.stringContaining('waits to build');

const stall: ViewStall = {
  event: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', type: 'run_succeeded', time: '2026-10-06T10:00:01.000Z' },
  kind: 'raised',
  message: 'cannot take bad',
  line: 31,
};

describe('a run of a recall function', () => {
  it('applies its answer to the view as it stands with the input, and records the checkpoint it answered at', async () => {
    const run = recallWith();
    run.keep(liveView(reviews));

    const answered = await run.running(campaignReviews, { campaign: 'spring', last: 1 });

    expect(answered).toMatchObject(
      Exit.succeed({
        output: [{ at: '2026-10-06T10:00:03.000Z', verdict: 'reject', run: '/runs/b' }],
        record: {
          language: 'typescript',
          input_bytes: 30,
          output_bytes: 70,
          view: {
            version: 1,
            checkpoint: 'YnJhaW4vYWNtZS9hbHBoYS8sNDI',
            checkpoint_at: '2026-10-06T10:00:05.000Z',
            folded: 5,
            last_event: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', time: '2026-10-06T10:00:04.000Z' },
          },
        },
      }),
    );
  });

  it('answers the view itself when it has no answer, and the initial view when it has folded nothing', async () => {
    const run = recallWith();
    run.keep(liveView({ count: 3 }));

    const answered = await run.running(recallDocument(foldOf('return view + 1;')));
    run.keep(liveView(null, { folded: 0, lastEvent: null }));
    const initial = await run.running(recallDocument(foldOf('return view + 1;')));

    expect(answered).toMatchObject(Exit.succeed({ output: { count: 3 }, record: { work: 0, output_bytes: 11 } }));
    expect(initial).toMatchObject(Exit.succeed({ output: null, record: { view: { folded: 0, last_event: null } } }));
  });
});

describe('the input of a run of a recall function', () => {
  it('refuses an input its schema refuses, of the kind input_schema, or one nested deeper than a value may, with a pointer', async () => {
    const run = recallWith();
    run.keep(liveView(reviews));
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], null);

    expect(await run.running(campaignReviews, { last: 1 })).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input: expected the field campaign.',
          issues: [{ pointer: '/campaign', detail: 'The input: expected the field campaign.' }],
          kind: 'input_schema',
        }),
      ),
    );
    expect(await run.running(campaignReviews, deep)).toMatchObject(
      Exit.fail({ detail: 'The input nests more than the 512 levels a recall function takes' }),
    );
  });
});

describe('a run of a recall function whose view is not ready', () => {
  it('is unavailable, rebuilding, while its view is missing, of an older version, waiting or being built', async () => {
    const run = recallWith();
    const notBegun = await run.running(campaignReviews, { campaign: 'spring' });
    run.keep(liveView(reviews, { version: 0 }));
    const older = await run.running(campaignReviews, { campaign: 'spring' });
    run.keep(liveView(reviews, { phase: 'waiting' }));
    const waiting = await run.running(campaignReviews, { campaign: 'spring' });
    run.keep(liveView(reviews, { phase: 'rebuilding', folded: 40 }));
    run.newest('2026-10-06T10:00:35.000Z');
    const building = await run.running(campaignReviews, { campaign: 'spring' });

    expect(notBegun).toMatchObject(Exit.fail({ kind: 'rebuilding' }));
    expect(older).toEqual(notBegun);
    expect(waiting).toMatchObject(Exit.fail({ kind: 'rebuilding', detail: waitsToBuild }));
    expect(building).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            "The recall function “reviews” is building its view of version 1 from the playbook's history: it has folded 40 events so far, and is 30 seconds behind the playbook's newest record; try again in a little while",
          kind: 'rebuilding',
        }),
      ),
    );
  });

  it('is a conflict, stalled, while its view has stalled, in fixed words without the event’s id or values', async () => {
    const run = recallWith();
    run.keep(liveView(reviews, { phase: 'stalled', stall }));

    expect(await run.running(campaignReviews, { campaign: 'spring' })).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            "The view of the recall function “reviews” stopped at the run_succeeded event of 2026-10-06T10:00:01.000Z: its fold raised an error on line 31. Save a corrected version to build the view again from the playbook's history",
          kind: 'stalled',
        }),
      ),
    );
  });
});
