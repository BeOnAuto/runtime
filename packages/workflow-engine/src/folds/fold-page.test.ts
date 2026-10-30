import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import type { InstanceSource } from '../instances/instance-source.ts';
import {
  adding,
  byCampaign,
  folded,
  pageOf,
  runningClock,
  slowFirstFold,
  springApproved,
  stillTiming,
  succeeded,
  viewOf,
  type Timing,
} from '../pool-testing/fold-pages.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';

function foldsTaking(stepMs: number, mark: (text: string) => void): Timing {
  const time = { now: 0 };
  return {
    now: () => time.now,
    folding: (event, view) => {
      mark(`${event}:${view}`);
      time.now += stepMs;
    },
  };
}

const counting = [
  'export function fold(view, event) {',
  '  let spent = 0;',
  '  for (let index = 0; index < 30000 + event.time.length; index++) spent += index;',
  '  const campaign = event.data.output.campaign;',
  '  return { ...view, [campaign]: (view[campaign] ?? 0) + (spent > 0 ? 1 : 0) };',
  '}',
].join('\n');

const thirty = Array.from({ length: 30 }, (_, index) =>
  succeeded(
    `campaign-${index % 4}`,
    index % 3 === 0 ? 'approve' : 'reject',
    `2026-10-01T09:00:${String(index).padStart(2, '0')}Z`,
  ),
);

interface Folding {
  readonly view: Json;
  readonly work: number;
}

const nothingFolded: Folding = { view: {}, work: 0 };

async function foldedInPages(source: InstanceSource, size: number, from = nothingFolded, start = 0): Promise<Folding> {
  if (start >= thirty.length) {
    return from;
  }
  const events = thirty.slice(start, start + size);
  const page = await folded(
    source,
    pageOf([viewOf(counting, { view: from.view, events: events.map((_, index) => index) })], { events }),
  );
  const [result] = page.views;
  return foldedInPages(
    source,
    size,
    { view: result?.view ?? null, work: from.work + (result?.work ?? 0) },
    start + size,
  );
}

describe.each(sourcesUnderTest)('a page of folds on $name instances', ({ source }) => {
  it('folds each event a view considers and its filters match, in order, each fold a function of the view and the event', async () => {
    const marks: string[] = [];

    const page = await folded(
      source,
      pageOf([viewOf(byCampaign), viewOf(adding, { view: 0, events: [2, 3] })]),
      stillTiming((mark) => {
        marks.push(mark);
      }),
    );

    expect(page).toMatchObject({
      early: false,
      views: [
        {
          view: {
            spring: [
              { at: '2026-10-01T09:00:00Z', verdict: 'approve' },
              { at: '2026-10-01T09:00:03Z', verdict: 'reject' },
            ],
            summer: [{ at: '2026-10-01T09:00:02Z', verdict: 'reject' }],
          },
          folded: 3,
          lastFolded: 3,
          through: 3,
        },
        { view: 2, folded: 2, lastFolded: 3, through: 3 },
      ],
    });
    expect(marks).toEqual(['0:0', '1:0', '2:0', '2:1', '3:0', '3:1']);
  });

  it('gives a fold the time of its event as the moment of Date, and none to an event without a time', async () => {
    const stamping = 'export function fold(view) {\n  return [...view, new Date().toISOString()];\n}';
    const timeless = { ...springApproved, time: 7 };

    const page = await folded(source, pageOf([viewOf(stamping, { view: [] })], { events: [springApproved, timeless] }));

    expect(page.views[0]?.view).toEqual(['2026-10-01T09:00:00.000Z', '1970-01-01T00:00:00.000Z']);
  });
});

describe.each(sourcesUnderTest)('the events a page of folds folds on $name instances', ({ source }) => {
  it('keeps a view as it was when no event of the page is one it considers', async () => {
    expect((await folded(source, pageOf([viewOf(byCampaign, { events: [] })]))).views[0]).toEqual({
      view: {},
      folded: 0,
      lastFolded: -1,
      through: 3,
      work: 0,
    });
    expect(await folded(source, pageOf([], { events: [] }))).toEqual({ early: false, views: [] });
  });

  it('ends early once its budget of time is spent, before the next fold, each view answering how far it went', async () => {
    const page = await folded(source, pageOf([viewOf(adding, { view: 0 })], { pageBudgetMs: 5 }), runningClock(3));

    expect(page).toMatchObject({ early: true, views: [{ view: 1, folded: 1, lastFolded: 0, through: 0 }] });
  });

  it('checks its budget before every fold, so a neighbour of a slow fold is never folded past the budget', async () => {
    const marks: string[] = [];
    const views = Array.from({ length: 4 }, () => viewOf(adding, { view: 0, events: [0] }));

    const page = await folded(
      source,
      pageOf(views, { events: [springApproved], foldDeadlineMs: 5000 }),
      foldsTaking(2100, (mark) => {
        marks.push(mark);
      }),
    );

    expect(page).toMatchObject({
      early: true,
      views: [
        { folded: 1, through: 0 },
        { folded: 0, through: -1 },
        { folded: 0, through: -1 },
        { folded: 0, through: -1 },
      ],
    });
    expect(marks).toEqual(['0:0']);
    expect(page.views.some(({ overtime }) => overtime !== undefined)).toBe(false);
  });

  it('runs at least one fold a page, however small its budget', async () => {
    const page = await folded(source, pageOf([viewOf(adding, { view: 0 })], { pageBudgetMs: 0 }), runningClock(3));

    expect(page).toMatchObject({ early: true, views: [{ folded: 1, through: 0 }] });
  });
});

describe.each(sourcesUnderTest)('the filters of a view in a page of folds on $name instances', ({ source }) => {
  it('match an event by an expression over its data, under the deadline and the budget of its fold', async () => {
    const approved = [{ type: 'run_succeeded', data: '${ $data.output.verdict == "approve" }' }];
    const slowFilter = [{ type: 'run_succeeded', data: '${ (() => { for (;;) {} })() }' }];
    const approving = viewOf(adding, { view: 0, filters: approved });
    const slow = viewOf(adding, { view: 0, filters: slowFilter });

    const timed = await folded(
      source,
      pageOf([slow], { foldDeadlineMs: 10, pageBudgetMs: 1_000_000 }),
      slowFirstFold(20),
    );
    const counted = await folded(source, pageOf([approving, slow]));

    expect(timed.views[0]).toMatchObject({ view: 0, folded: 0, overtime: 0 });
    expect(counted.views[0]).toMatchObject({ view: 1, folded: 1, through: 3 });
    expect(counted.views[1]).toMatchObject({ view: 0, folded: 0, stall: { at: 0, kind: 'work' } });
  });

  it('do not match an event when their expression raises', async () => {
    const filters = [{ type: 'run_succeeded', data: '${ $data.missing.field }' }];

    expect((await folded(source, pageOf([viewOf(adding, { view: 0, filters })]))).views[0]).toMatchObject({
      view: 0,
      folded: 0,
      through: 3,
    });
  });

  it('do not match an event when their expression is not erasable', async () => {
    const filters = [{ type: 'run_succeeded', data: '${ <number>$data }' }];

    expect((await folded(source, pageOf([viewOf(adding, { view: 0, filters })]))).views[0]).toMatchObject({
      folded: 0,
    });
  });
});

describe.each(sourcesUnderTest)('the folds of one view on $name instances', ({ source }) => {
  it('give the same view and the same work whatever the size of the pages they are folded in', async () => {
    const whole = await foldedInPages(source, 30);

    expect(whole.work).toBeGreaterThan(0);
    expect([await foldedInPages(source, 7), await foldedInPages(source, 1)]).toEqual([whole, whole]);
  });
});
