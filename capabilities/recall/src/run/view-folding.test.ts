import { Buffer } from 'node:buffer';

import type { FoldRequest, ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { ViewDetails } from '@on.auto/workflow-host';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { patientPage, poolOf } from '../testing/recall-runs.ts';
import { runnableDetailsOf } from '../testing/runnable-details.ts';
import { recallFolding } from './recall-bounds.ts';

function review(at: string, output: Schema.Json): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: `run-${at}`,
    source: `/runs/${at}`,
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time: at,
    data: { type: 'reasoning', name: 'review-brief', version: 1, output },
  };
}

const controlCharacter = '\u0000';

function longestName(campaign: number): string {
  return `${String.fromCodePoint(14 + Math.floor(campaign / 18), 14 + (campaign % 18))}${controlCharacter.repeat(98)}`;
}

function momentAt(seconds: number): string {
  return new Date(Date.UTC(2026, 9, 6) + seconds * 1000).toISOString();
}

function runAt(seconds: number): string {
  return `/runs/0199a3c4-7d2e-7c1a-9b3f-${String(seconds).padStart(12, '0')}`;
}

function longestReview(seconds: number) {
  return { at: momentAt(seconds), verdict: controlCharacter.repeat(60), run: runAt(seconds) };
}

function longestReviewsOf(campaign: number) {
  return Array.from({ length: 20 }, (_, index) => longestReview(campaign * 20 + index));
}

function fullestViewOf(campaigns: readonly number[]) {
  return Object.fromEntries(campaigns.map((campaign) => [longestName(campaign), longestReviewsOf(campaign)]));
}

const fullestView = fullestViewOf(Array.from({ length: 50 }, (_, campaign) => campaign));

function overlongReview(campaign: number, seconds: number): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: `review-${seconds}`,
    source: runAt(seconds),
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time: momentAt(seconds),
    data: {
      type: 'reasoning',
      name: 'review-brief',
      version: 1,
      output: {
        campaign: `${longestName(campaign)}${controlCharacter.repeat(50)}`,
        verdict: controlCharacter.repeat(100),
      },
    },
  };
}

function bytesOf(view: Schema.Json): number {
  return Buffer.byteLength(JSON.stringify(view), 'utf8');
}

function folded(pool: ProgramPool, details: ViewDetails, events: readonly Schema.JsonObject[]) {
  const { fold, filters, initial, schema } = details;
  const request: FoldRequest = {
    ...recallFolding,
    events,
    views: [
      {
        fold,
        filters,
        view: initial,
        ...(schema === undefined ? {} : { schema }),
        events: events.map((_, index) => index),
      },
    ],
    ...patientPage,
  };
  return pool.fold(request);
}

describe('the checked worker, folding the views of recall functions', () => {
  it('folds the example over the runs it names, in order, checking the view against its schema after each fold', async () => {
    const events = [
      review('2026-10-06T10:00:00.000Z', { campaign: 'spring', verdict: 'approve' }),
      review('2026-10-06T10:00:01.000Z', 'a plain text answer'),
      review('2026-10-06T10:00:02.000Z', { campaign: 'spring', verdict: 'reject' }),
    ];

    expect(await folded(poolOf(), await runnableDetailsOf(campaignReviews), events)).toMatchObject({
      ran: 'folded',
      views: [
        {
          folded: 3,
          view: {
            unknown: [{ at: '2026-10-06T10:00:01.000Z', verdict: 'none', run: '/runs/2026-10-06T10:00:01.000Z' }],
            spring: [
              { at: '2026-10-06T10:00:00.000Z', verdict: 'approve', run: '/runs/2026-10-06T10:00:00.000Z' },
              { at: '2026-10-06T10:00:02.000Z', verdict: 'reject', run: '/runs/2026-10-06T10:00:02.000Z' },
            ],
          },
        },
      ],
    });
  });

  it('stops a view at the event after which its schema refuses it, naming where', async () => {
    const front =
      'language: typescript\nsource:\n  events:\n    - type: run_succeeded\nview:\n  initial: {}\n  schema: {additionalProperties: {type: integer}}';
    const details = await runnableDetailsOf(
      recallDocument(foldOf('return { ...view, [event.time]: event.data.output };'), front),
    );
    const events = [review('2026-10-06T10:00:00.000Z', 1), review('2026-10-06T10:00:01.000Z', 'two')];

    expect(await folded(poolOf(), details, events)).toMatchObject({
      ran: 'folded',
      views: [
        {
          view: { '2026-10-06T10:00:00.000Z': 1 },
          folded: 1,
          stall: { at: 1, kind: 'schema', message: '/2026-10-06T10:00:01.000Z: Expected number' },
        },
      ],
    });
  });
});

describe('the example of the reference page, at its largest', () => {
  it('holds its view at 488,251 bytes as JSON, however long the names and verdicts it is given', async () => {
    const details = await runnableDetailsOf(campaignReviews);
    const events = [overlongReview(0, 1000), overlongReview(49, 1001)];
    const held = {
      ...fullestView,
      [longestName(0)]: [...longestReviewsOf(0).slice(1), longestReview(1000)],
      [longestName(49)]: [...longestReviewsOf(49).slice(1), longestReview(1001)],
    };

    expect([bytesOf(fullestView), bytesOf(held)]).toEqual([488_251, 488_251]);
    expect(await folded(poolOf(), { ...details, initial: fullestView }, events)).toMatchObject({
      ran: 'folded',
      views: [{ folded: 2, view: held }],
    });
  });

  it('keeps the 50 campaigns reviewed most recently, dropping the one whose last review is oldest', async () => {
    const details = await runnableDetailsOf(campaignReviews);
    const later = fullestViewOf(Array.from({ length: 49 }, (_, index) => index + 1));
    const kept = { ...later, [longestName(50)]: [longestReview(1000)] };

    expect(await folded(poolOf(), { ...details, initial: fullestView }, [overlongReview(50, 1000)])).toMatchObject({
      ran: 'folded',
      views: [{ folded: 1, view: kept }],
    });
  });
});
