import { readFileSync } from 'node:fs';

import { Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { recallFolding } from '../run/recall-bounds.ts';
import { campaignReviews } from '../testing/campaign-reviews.ts';
import { liveView, patientPage, poolOf, recallWith } from '../testing/recall-runs.ts';
import { runnableDetailsOf } from '../testing/runnable-details.ts';
import { parseRecallDocument } from './document-parsing.ts';

const referencePage = readFileSync(new URL('../../../../docs/reference/recall-format.md', import.meta.url), 'utf8');

const fencedBlocks = [...referencePage.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const reviews = [
  ['2026-09-30T14:02:11.000Z', '71', { campaign: 'autumn-launch', verdict: 'approve' }],
  ['2026-10-01T09:15:42.000Z', '72', { campaign: 'spring-sale', verdict: 'reject: the budget is not stated' }],
  ['2026-10-03T16:40:05.000Z', '73', { campaign: 'spring-sale', verdict: 'approve' }],
] as const;

type Review = readonly [time: string, run: string, output: Schema.JsonObject];

function reviewEvents(written: readonly Review[]) {
  return written.map(([time, run, output]) => ({
    specversion: '1.0',
    id: `5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f${run}`,
    source: `/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b${run}`,
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time,
    data: { type: 'reasoning', name: 'review-brief', version: 1, caller: 'acme-admin', output },
  }));
}

const events = reviewEvents(reviews);

const inheritedNames = ['constructor', '__proto__', 'toString'] as const;

function inheritedReview(round: number, campaign: string, index: number): Review {
  return [`2026-10-0${round * 3 + index + 1}T09:00:00.000Z`, `${round + 7}${index}`, { campaign, verdict: 'approve' }];
}

const rounds: readonly (readonly Review[])[] = [1, 2].map((round) =>
  inheritedNames.map((campaign, index) => inheritedReview(round, campaign, index)),
);

function keptReview([time, run]: Review) {
  return { at: time, verdict: 'approve', run: `/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b${run}` };
}

function keptInEachRound(index: number) {
  return rounds.flatMap((round) => round.slice(index, index + 1).map((review) => keptReview(review)));
}

function announcementRun(index: number) {
  const run = String(index).padStart(2, '0');
  return { time: `2026-10-07T09:${run}:00.000Z`, source: `/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8c${run}` };
}

type Outcome = { readonly output: Schema.Json } | { readonly output_bytes: number };

function announcement(index: number, outcome: Outcome): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: `announcement-${index}`,
    ...announcementRun(index),
    type: 'run_succeeded',
    subject: 'reasoning/post-announcement',
    data: { type: 'reasoning', name: 'post-announcement', version: 1, caller: 'acme-admin', ...outcome },
  };
}

function keptAs(index: number, output: Schema.Json): Schema.JsonObject {
  const { time, source } = announcementRun(index);
  return { at: time, run: source, output };
}

async function foldedOver(source: string, foldedEvents: readonly Schema.JsonObject[]) {
  const { fold, filters, initial, schema = {} } = await runnableDetailsOf(source);
  return poolOf().fold({
    ...recallFolding,
    ...patientPage,
    events: foldedEvents,
    views: [{ fold, filters, view: initial, schema, events: foldedEvents.map((_, index) => index) }],
  });
}

async function foldedEntries(foldedEvents: readonly Schema.JsonObject[]) {
  const folding = await foldedOver(campaignReviews, foldedEvents);
  return folding.ran === 'folded'
    ? folding.views.map(({ folded, view }) => ({ folded, entries: Object.entries(view ?? {}) }))
    : folding;
}

const largestKept = 'x'.repeat(8190);

describe('the example on the reference page of recall functions', () => {
  it('is, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${campaignReviews}\n`);
  });

  it('folds the three runs of review-brief to the view the page shows', async () => {
    const [, view] = fencedBlocks;

    expect(view?.language).toBe('json');
    expect(await foldedOver(campaignReviews, events)).toMatchObject({
      ran: 'folded',
      views: [{ folded: 3, view: decodeJson(view?.body) }],
    });
  });

  it('answers the input the page gives with the output the page shows', async () => {
    const [, view, input, output] = fencedBlocks;
    const run = recallWith();
    run.keep(liveView(decodeJson(view?.body)));

    expect([input?.language, output?.language]).toEqual(['json', 'json']);
    expect(await run.running(campaignReviews, decodeJson(input?.body))).toMatchObject(
      Exit.succeed({ output: decodeJson(output?.body) }),
    );
  });
});

describe('the fold of the example on the reference page', () => {
  it('keeps a campaign named like a property every object inherits as an entry of its own', async () => {
    expect(await foldedEntries(reviewEvents(rounds.flat()))).toEqual([
      { folded: 6, entries: inheritedNames.map((campaign, index) => [campaign, keptInEachRound(index)]) },
    ]);
  });

  it('answers a campaign named like an inherited property from the entries the view holds itself', async () => {
    const run = recallWith();
    const kept = keptInEachRound(2).slice(-1);
    run.keep(liveView(decodeJson(JSON.stringify({ toString: kept }))));

    expect(
      await Promise.all(inheritedNames.map((campaign) => run.running(campaignReviews, { campaign }))),
    ).toMatchObject([Exit.succeed({ output: [] }), Exit.succeed({ output: [] }), Exit.succeed({ output: kept })]);
  });
});

describe('the example of the common case on the reference page', () => {
  const [, , , , document] = fencedBlocks;
  const source = document?.body ?? '';

  it('folds the succeeded runs of post-announcement, by the filter written out', () => {
    expect(document?.language).toBe('markdown');
    expect(Result.getOrThrow(parseRecallDocument(source)).details.filters).toEqual([
      { type: 'run_succeeded', subject: 'reasoning/post-announcement' },
    ]);
  });

  it('keeps the output of each run, and as null one over 8 KiB as JSON or too large for its event', async () => {
    const posted = { channel: 'launches', text: 'The autumn launch is live.' };
    const runs = [
      announcement(0, { output: posted }),
      announcement(1, { output: largestKept }),
      announcement(2, { output: `${largestKept}x` }),
      announcement(3, { output_bytes: 250_000 }),
    ];

    expect(await foldedOver(source, runs)).toMatchObject({
      ran: 'folded',
      views: [
        {
          folded: 4,
          view: [keptAs(0, posted), keptAs(1, largestKept), keptAs(2, null), keptAs(3, null)],
        },
      ],
    });
  });

  it('keeps the last 50 runs, under the bound on a view when every output takes its 8 KiB', async () => {
    const runs = Array.from({ length: 51 }, (_, index) => announcement(index, { output: largestKept }));

    expect(await foldedOver(source, runs)).toMatchObject({
      ran: 'folded',
      views: [{ folded: 51, view: Array.from({ length: 50 }, (_, index) => keptAs(index + 1, largestKept)) }],
    });
  });
});
