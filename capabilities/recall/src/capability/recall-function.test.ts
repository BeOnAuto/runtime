import type { ViewStall } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith } from '../testing/recall-runs.ts';

const stall: ViewStall = {
  event: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', type: 'run_succeeded', time: '2026-10-06T10:00:01.000Z' },
  kind: 'raised',
  message: 'cannot take bad',
  line: 31,
};

const alpha = { org: 'acme', playbook: 'alpha', name: 'reviews', version: 1 };

describe('a recall function', () => {
  it('describes its result in words', () => {
    const { capability } = recallWith(poolOf({ workers: 1 }));

    expect(capability.describeOutput([{ verdict: 'approve' }])).toBe('Its result: (verdict: “approve”).');
    expect(capability.describeOutput('x'.repeat(5000))).toBe(
      'Its result is too long to repeat here; the whole of it is in the details below.',
    );
  });

  it('is a function of the playbook that reaches nothing outside, of which a playbook keeps at most thirty-two', () => {
    const { capability, prepared } = recallWith(poolOf({ workers: 1 }));

    expect(capability).toMatchObject({
      type: 'recall',
      title: 'Recall',
      noun: { one: 'recall function', other: 'recall functions' },
      mediaType: 'text/markdown',
      reachesOutside: false,
      mayChangeOutside: false,
      longestAnyRunMs: 10_000,
      mostActive: 32,
    });
    expect(capability.guide).toEqual({ name: 'recall-function' });
    expect(prepared(campaignReviews).callsTools).toBe(false);
  });
});

describe('the summary of a recall function', () => {
  it('is its description, its schemas and the details the host folds its view by', () => {
    const { prepared } = recallWith(poolOf({ workers: 1 }));

    expect(prepared(campaignReviews).summary).toMatchObject({
      description: 'The reviews of each campaign, latest last, as the review-brief function wrote them',
      inputSchema: { type: 'object', required: ['campaign'] },
      outputSchema: { type: 'array' },
      details: {
        language: 'typescript',
        foldLine: 29,
        filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
        initial: {},
      },
    });
    expect(prepared(recallDocument(foldOf('return view + 1;'))).summary).toEqual({
      details: {
        language: 'typescript',
        fold: foldOf('return view + 1;'),
        foldLine: 7,
        filters: [{ type: 'run_succeeded' }],
        initial: null,
      },
    });
  });
});

describe('a recall function definition with problems', () => {
  it('refuses a definition with its problems, each with its line', async () => {
    const { capability } = recallWith(poolOf({ workers: 1 }));

    expect(
      await Effect.runPromise(
        Effect.flip(capability.prepare(recallDocument('  ', 'language: python\nsource: {events: [{type: x}]}'))),
      ),
    ).toMatchObject({
      detail: 'The recall function definition has 2 problems',
      issues: [
        {
          pointer: '',
          detail:
            "Line 2, /language: The playbook's one language is TypeScript; write the program as a TypeScript function",
        },
        {
          pointer: '',
          detail: 'Line 5: The definition has no program: write the module with its fold after the front matter',
        },
      ],
    });
    expect(
      await Effect.runPromise(
        Effect.flip(
          capability.prepare(recallDocument(foldOf('return view;'), 'language: python\nsource: {events: [{type: x}]}')),
        ),
      ),
    ).toMatchObject({ detail: 'The recall function definition has a problem' });
  });
});

describe('the standing of a recall function', () => {
  it('is its view’s state, version, checkpoint, count folded and lag behind the playbook’s newest record', async () => {
    const run = recallWith(poolOf({ workers: 1 }));
    run.keep(liveView({}));
    run.newest('2026-10-06T10:00:07.000Z');

    expect(await Effect.runPromise(run.capability.standing({ ...alpha, status: 'active' }))).toEqual({
      state: 'live',
      version: 1,
      checkpoint: 'YnJhaW4vYWNtZS9hbHBoYS8sNDI',
      checkpoint_at: '2026-10-06T10:00:05.000Z',
      folded: 5,
      last_event: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', time: '2026-10-06T10:00:04.000Z' },
      lag_ms: 2000,
      newest_record_at: '2026-10-06T10:00:07.000Z',
    });
  });

  it('is rebuilding before its view of the version saved exists, and waiting behind others', async () => {
    const run = recallWith(poolOf({ workers: 1 }));
    const missing = await Effect.runPromise(run.capability.standing({ ...alpha, version: 2, status: 'active' }));
    run.keep(liveView({}, { phase: 'waiting', checkpoint: null, checkpointAt: null, lastEvent: null, folded: 0 }));
    const waiting = await Effect.runPromise(run.capability.standing({ ...alpha, status: 'active' }));

    expect(missing).toEqual({
      state: 'rebuilding',
      version: 2,
      checkpoint: null,
      checkpoint_at: null,
      folded: 0,
      lag_ms: null,
      newest_record_at: null,
    });
    expect(waiting).toMatchObject({ state: 'waiting', checkpoint: null, last_event: null, lag_ms: null });
  });
});

describe('the standing of a stalled or retired recall function', () => {
  it('names the event a stalled view stopped at and its raw error, and is nothing once retired', async () => {
    const run = recallWith(poolOf({ workers: 1 }));
    run.keep(liveView({}, { phase: 'stalled', stall }));

    expect(await Effect.runPromise(run.capability.standing({ ...alpha, status: 'active' }))).toMatchObject({
      state: 'stalled',
      stalled: { event: stall.event, kind: 'raised', error: 'cannot take bad', line: 31 },
    });
    expect(await Effect.runPromise(run.capability.standing({ ...alpha, status: 'retired' }))).toBeUndefined();
  });
});
