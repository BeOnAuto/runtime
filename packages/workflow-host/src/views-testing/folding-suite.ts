import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { campaignReviews } from './campaign-reviews.ts';
import { collecting, counting, detailsOf, foldOf, foldedAll, foldingOf, liveFromSomewhere } from './view-documents.ts';
import { viewHarness } from './view-harness.ts';

const reviewBrief = 'reasoning/review-brief';

const anyText: unknown = expect.any(String);

function month(id: string, data: Schema.Json, source = '/ledger/eu'): Schema.JsonObject {
  return {
    specversion: '1.0',
    id,
    source,
    type: 'com.acme.ledger.month-closed',
    subject: id,
    time: '2026-10-01T09:00:00Z',
    data,
  };
}

function reviewsTests(settingsOf: SettingsOf): void {
  it('folds the runs of a reasoning function in the order the playbook recorded them, guarded against what an output may be, one over the event bound seen as its size', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('reviews', campaignReviews);
    const spring = await views.ran(
      reviewBrief,
      { campaign: 'spring', verdict: 'approve' },
      { at: '2026-10-06T10:00:00.000Z' },
    );
    const text = await views.ran(reviewBrief, 'a plain text answer', { at: '2026-10-06T10:00:01.000Z' });
    const array = await views.ran(reviewBrief, ['an', 'array'], { at: '2026-10-06T10:00:02.000Z' });
    const numbers = await views.ran(reviewBrief, { campaign: 7, verdict: 3 }, { at: '2026-10-06T10:00:03.000Z' });
    const oversized = { campaign: 'spring', verdict: 'x'.repeat(300_000) };
    const over = await views.ran(reviewBrief, oversized, { at: '2026-10-06T10:00:04.000Z' });
    await views.ran('reasoning/other', { campaign: 'spring', verdict: 'reject' }, { at: '2026-10-06T10:00:05.000Z' });
    views.start();

    const kept = await views.until('reviews', foldedAll(5));

    expect(kept).toMatchObject({ name: 'reviews', version: 1, phase: 'live', folded: 5 });
    expect(kept.view).toEqual({
      unknown: [
        { at: '2026-10-06T10:00:01.000Z', verdict: 'none', run: `/runs/${text}` },
        { at: '2026-10-06T10:00:02.000Z', verdict: 'none', run: `/runs/${array}` },
        { at: '2026-10-06T10:00:03.000Z', verdict: '3', run: `/runs/${numbers}` },
        { at: '2026-10-06T10:00:04.000Z', verdict: 'none', run: `/runs/${over}` },
      ],
      spring: [{ at: '2026-10-06T10:00:00.000Z', verdict: 'approve', run: `/runs/${spring}` }],
    });
    expect(JSON.stringify(kept.view)).toMatch(/^\{"spring":.*"unknown":/u);
    expect(kept.lastEvent?.time).toBe('2026-10-06T10:00:04.000Z');
  });
}

function checkpointTests(settingsOf: SettingsOf): void {
  it('moves its checkpoint to the last record examined, though no record matched its filters', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('quiet', detailsOf(foldOf('return view + 1;'), [{ type: 'com.acme.never' }], { initial: 0 }));
    await views.ran('reasoning/other', 'nothing to fold');
    views.start();

    const caught = await views.until('quiet', liveFromSomewhere);
    await views.ran('reasoning/other', 'still nothing');
    const moved = await views.until('quiet', ({ checkpoint }) => checkpoint !== caught.checkpoint);

    expect([caught.view, caught.folded, moved.view, moved.folded]).toEqual([0, 0, 0, 0]);
  });

  it('folds the events of more than a page, every one once and in order', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('count', collecting);
    const outputs = Array.from({ length: 2300 }, (_, index) => index);
    await views.ranInOneStream('reasoning/count', outputs);
    views.start();

    const kept = await views.until('count', foldedAll(outputs.length));

    expect(kept.view).toEqual(outputs);
  });

  it('ends a page early once its time is spent, and goes on from there with nothing stalled', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('slow', counting);
    await views.ranEach('reasoning/slow', [1, 2, 3, 4]);
    views.start({ folding: { ...foldingOf(), pageBudgetMs: 0 } });

    const kept = await views.until('slow', foldedAll(4));

    expect(kept).toMatchObject({ phase: 'live', view: 4 });
    expect(kept).not.toHaveProperty('stall');
    expect(views.reads()).toBeGreaterThanOrEqual(4);
  });
}

function sourceTests(settingsOf: SettingsOf): void {
  it('never folds the runs of its own recall function, and folds those of another', async () => {
    const views = await viewHarness(await settingsOf());
    const runs = [
      { type: 'run_succeeded', subject: 'recall/self' },
      { type: 'run_succeeded', subject: 'recall/other' },
    ];
    await views.saved('self', detailsOf(foldOf('return view + 1;'), runs, { initial: 0 }));
    await views.ran('recall/self', 'its own answer');
    await views.ran('recall/other', 'an answer of another');
    await views.ran('recall/self', 'its own answer again');
    views.start();

    const kept = await views.until('self', liveFromSomewhere);

    expect([kept.view, kept.folded]).toEqual([1, 1]);
  });

  it('folds the events published to the playbook as their publishers gave them, matched by type, source and data', async () => {
    const views = await viewHarness(await settingsOf());
    const filters = [{ type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ $data.revenue > 100 }' }];
    const fold = foldOf('return [...view, { id: event.id, subject: event.subject, time: event.time }];');
    await views.saved('months', detailsOf(fold, filters, { initial: [] }));
    await views.published(month('m-08', { revenue: 120 }));
    await views.published(month('m-09', { revenue: 90 }));
    await views.published(month('m-10', { revenue: 130 }, '/ledger/us'));
    await views.published(month('m-11', 'not a number'));
    await views.published(month('m-12', { revenue: 140 }));
    views.start();

    const kept = await views.until('months', foldedAll(2));

    expect(kept.view).toEqual([
      { id: 'm-08', subject: 'm-08', time: '2026-10-01T09:00:00Z' },
      { id: 'm-12', subject: 'm-12', time: '2026-10-01T09:00:00Z' },
    ]);
  });
}

function recordTests(settingsOf: SettingsOf): void {
  it('gives a fact its message id, its cause and its run', async () => {
    const views = await viewHarness(await settingsOf());
    const fold = foldOf(
      'return [...view, { id: event.id, causationid: event.causationid ?? null, correlationid: event.correlationid ?? null }];',
    );
    await views.saved('ids', detailsOf(fold, [{ type: 'run_succeeded' }], { initial: [] }));
    const run = await views.ran('reasoning/ids', 'answered');
    views.start();

    const kept = await views.until('ids', foldedAll(1));

    expect(kept.view).toEqual([{ id: anyText, causationid: null, correlationid: null }]);
    expect(kept.lastEvent?.id).not.toContain(run);
  });
}

function passedOverTests(settingsOf: SettingsOf): void {
  it('passes over a record it cannot read, an event nested deeper than a fold may read and one at a leap second, which gives a fold no moment, reporting each, and folds the rest', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved(
      'count',
      detailsOf(foldOf('return view + 1;'), [{ type: 'run_succeeded' }, { type: 'com.acme.deep' }], {
        initial: 0,
      }),
    );
    await views.ran('reasoning/count', 'one');
    await views.append('playbook/acme/alpha/runs/broken', [{ type: 'run_succeeded', data: { type: 'run_succeeded' } }]);
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], null);
    await views.published({
      specversion: '1.0',
      id: 'deep',
      source: '/acme',
      type: 'com.acme.deep',
      time: '2026-10-01T09:00:00Z',
      data: deep,
    });
    await views.published({
      specversion: '1.0',
      id: 'leap',
      source: '/acme',
      type: 'com.acme.deep',
      time: '2016-12-31T23:59:60Z',
      data: 1,
    });
    await views.ran('reasoning/count', 'two');
    views.start();

    const kept = await views.until('count', foldedAll(2));
    await views.until('count', () => views.reports.notes().length >= 3);

    expect(kept.view).toBe(2);
    expect(views.reports.notes()).toEqual([
      { kind: 'record_passed_over', playbook: 'playbook/acme/alpha/', record: anyText, reason: 'unreadable' },
      { kind: 'record_passed_over', playbook: 'playbook/acme/alpha/', record: anyText, reason: 'unreadable' },
      { kind: 'record_passed_over', playbook: 'playbook/acme/alpha/', record: anyText, reason: 'unreadable' },
    ]);
  });
}

export function foldingSuite(settingsOf: SettingsOf): void {
  describe('a view the projector keeps', () => {
    reviewsTests(settingsOf);
    checkpointTests(settingsOf);
    sourceTests(settingsOf);
    recordTests(settingsOf);
    passedOverTests(settingsOf);
  });
}
