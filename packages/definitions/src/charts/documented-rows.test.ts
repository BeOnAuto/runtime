import { readFileSync } from 'node:fs';

import { programPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Predicate, Result, type Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { pageCheckOn } from '../page/page-content.ts';
import { pageIn } from '../page/page-key.ts';
import { runsShown, resultShown, type ReadMoment } from '../page/page-rendering.ts';
import { measuredPoolSettings } from '../testing/read-on-disk.ts';
import { checkingWithin } from '../testing/time/patient-checks.ts';

const pageFormat = readFileSync(new URL('../../../../docs/reference/page-format.md', import.meta.url), 'utf8');

const layingOut = String(pageFormat.split('\n## Laying out a page\n')[1]?.split('\n## ')[0]);

function fencedIn(language: string): string {
  return String(layingOut.split(`\n\`\`\`\`${language}\n`)[1]?.split('\n````\n')[0]);
}

const documentedPage = fencedIn('yaml');

const documentedRuns = fencedIn('markdown');

const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

afterAll(() => pool.close());

const checkPage = pageCheckOn(checkingWithin(pool));

type Fold = (view: Schema.Json, event: Schema.Json) => Schema.Json;

function isFold(value: unknown): value is Fold {
  return typeof value === 'function';
}

async function foldOf(source: string): Promise<Fold> {
  const content = await Effect.runPromise(checkPage(source, 'workflow'));
  const module = content?.stripped?.module ?? '';
  const loaded: unknown = await import(`data:text/javascript,${encodeURIComponent(module)}`);
  const fold: unknown = Predicate.isObject(loaded) ? Reflect.get(loaded, 'fold') : undefined;
  if (!isFold(fold)) {
    throw new Error('The documented module exports no fold');
  }
  return fold;
}

interface Order {
  readonly time: string;
  readonly output: Schema.Json;
}

const latestOrder = { order: 'A-1043', channel: 'Web', total: 132.25 };

const orders: readonly Order[] = [
  { time: '2026-10-30T10:12:00Z', output: { order: 'A-1041', channel: 'Web', total: 86.5 } },
  { time: '2026-10-31T15:40:00Z', output: { order: 'A-1042', channel: 'Marketplace', total: 24 } },
  { time: '2026-11-01T08:05:00Z', output: latestOrder },
];

function eventOf({ time, output }: Order): Schema.Json {
  return {
    id: time,
    type: 'run_succeeded',
    source: '/definitions/workflow/fulfill-order',
    subject: 'workflow/fulfill-order',
    time,
    data: { output },
  };
}

const moment: ReadMoment = { today: '2026-11-01', now: '2026-11-01T09:30:00.000Z', clock: () => 0 };

const subject = { type: 'workflow', name: 'fulfill-order', description: null, version: 1 };

const parsed = Result.getOrThrow(
  Result.fromNullishOr(Option.getOrUndefined(Result.getOrThrow(pageIn(documentedPage, 'workflow'))), () => 'no page'),
);

const declared = parsed.data?.views ?? {};

describe('the documented page that lays out its charts in rows', () => {
  it('is saved, and renders the views its fold keeps of three orders as the Markdown the page format shows', async () => {
    const fold = await foldOf(documentedPage);
    const views = orders.reduce((view: Schema.Json, order: Order) => fold(view, eventOf(order)), {});
    const runs = Result.getOrThrow(Result.fromNullishOr(parsed.templates.runs, () => 'no runs'));

    expect(runsShown(runs, { state: 'live', views }, { declared, subject }, moment)).toBe(documentedRuns.trim());
    expect(fold(views, eventOf({ time: '2026-11-01T09:00:00Z', output: { order: 'A-1044' } }))).toBe(views);
  });

  it('shows a run of its subject as one headline', () => {
    const result = Result.getOrThrow(Result.fromNullishOr(parsed.templates.result, () => 'no result'));
    const run = { output: latestOrder, started: moment.now, ended: moment.now, version: 1 };

    expect(resultShown(result, { status: 'succeeded', ...run }, subject, moment)).toBe(
      'Order A-1043 fulfilled: $132.25, ordered through Web.',
    );
    expect(layingOut).toContain('`Order A-1043 fulfilled: $132.25, ordered through Web.`');
  });
});
