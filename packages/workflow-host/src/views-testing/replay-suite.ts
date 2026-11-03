import { checkedWorker } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { replayBounds, viewsAsOfOn } from '../pages/view-replay.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { countingPosts, folds, morning, pageDetails, postsOf, startedOnPages } from './page-documents.ts';
import { busyOnce } from './pool-faults.ts';
import { alpha, foldedAll, foldingOf, isStalled } from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

interface Replayed {
  readonly folding?: Partial<ReturnType<typeof foldingOf>>;
  readonly pages?: number;
  readonly database?: HostDatabase;
  readonly pool?: ViewHarness['pool'];
}

function asOf(views: ViewHarness, more: Replayed = {}) {
  const { folding, pages = replayBounds.pages, database = views.store.database, pool = views.pool } = more;
  const replay = viewsAsOfOn(database, { pool, folding: { ...foldingOf(), worker: checkedWorker, ...folding }, pages });
  return (run: string, name = morning) => Effect.runPromise(replay.viewAsOfRun(alpha, name, run));
}

function inPagesOf(database: HostDatabase, size: number): HostDatabase {
  return {
    ...database,
    store: {
      ...database.store,
      readRecorded: (playbookKey, selection, page) =>
        database.store.readRecorded(playbookKey, selection, { ...page, limit: Math.min(page.limit, size) }),
    },
  };
}

async function threeRuns(views: ViewHarness): Promise<readonly string[]> {
  await views.pageSaved(morning, 1, pageDetails(countingPosts));
  return [await views.ran(morning, 1), await views.ran(morning, 2), await views.ran(morning, 3)];
}

const raisingAtTheSecond = [
  'export function fold(view, event) {',
  '  if (event.data.output === 2) throw new Error("The second run stops this fold");',
  '  const posts = (view.by_channel?.values[0]?.value ?? 0) + 1;',
  "  return { by_channel: { unit: 'posts', values: [{ name: 'LinkedIn', value: posts }] } };",
  '}',
].join('\n');

function replayTests(settingsOf: SettingsOf): void {
  it('are the fold again up to the run’s last event, whatever the kept view holds, and write nothing', async () => {
    const views = await viewHarness(await settingsOf());
    const [first, second, third] = await threeRuns(views);
    startedOnPages(views);
    const kept = await views.until(morning, foldedAll(3));
    const replayed = asOf(views);

    expect(await replayed(String(first))).toMatchObject({ phase: 'live', view: postsOf(1), folded: 1 });
    expect(await replayed(String(second))).toMatchObject({ phase: 'live', view: postsOf(2), folded: 2 });
    expect(await replayed(String(third))).toMatchObject({ phase: 'live', view: postsOf(3), folded: 3 });
    expect((await replayed(String(third)))?.lastEvent).toEqual(kept.lastEvent);
    expect((await replayed(String(third)))?.checkpointAt).toEqual(kept.checkpointAt);
    expect(await views.viewOf(morning)).toEqual(kept);
  });

  it('read on across pages, up to the run and no further', async () => {
    const views = await viewHarness(await settingsOf());
    const [, second] = await threeRuns(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));

    const replayed = asOf(views, { database: inPagesOf(views.store.database, 1) });

    expect(await replayed(String(second))).toMatchObject({ phase: 'live', view: postsOf(2), folded: 2 });
  });

  it('go on after a page the fold’s budget ended early', async () => {
    const views = await viewHarness(await settingsOf());
    const [, , third] = await threeRuns(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));

    const replayed = asOf(views, { folding: { pageBudgetMs: 0 } });

    expect(await replayed(String(third))).toMatchObject({ phase: 'live', view: postsOf(3) });
  });

  it('do not need the row to have caught up, so a view still being built replays', async () => {
    const views = await viewHarness(await settingsOf());
    const [first] = await threeRuns(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));
    await views.stopProjectors();
    await views.pageSaved(morning, 2, pageDetails(folds('{ by_channel: { unit: "posts", values: [] } }')));

    expect(await views.viewOf(morning)).toMatchObject({ version: 1 });
    expect(await asOf(views)(String(first))).toMatchObject({ phase: 'live', view: postsOf(1) });
  });
}

function endingTests(settingsOf: SettingsOf): void {
  it('stop where the fold stalls, though a run before the stall replays', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(raisingAtTheSecond));
    const first = await views.ran(morning, 1);
    await views.ran(morning, 2);
    const third = await views.ran(morning, 3);
    startedOnPages(views);
    await views.until(morning, isStalled);
    const replayed = asOf(views);

    expect(await replayed(first)).toMatchObject({ phase: 'live', view: postsOf(1) });
    expect(await replayed(third)).toMatchObject({
      phase: 'stalled',
      view: postsOf(1),
      stall: { kind: 'raised', event: { type: 'run_succeeded' } },
    });
  });

  it('are out of reach past their pages, with the view’s version alone', async () => {
    const views = await viewHarness(await settingsOf());
    const [, , third] = await threeRuns(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));
    const database = inPagesOf(views.store.database, 1);

    expect(await asOf(views, { database, pages: 2 })(String(third))).toEqual({
      name: morning,
      version: 1,
      phase: 'out_of_reach',
      view: {},
      checkpoint: null,
      checkpointAt: null,
      lastEvent: null,
      folded: 0,
    });
  });
}

function reachTests(settingsOf: SettingsOf): void {
  it('are out of reach when no worker folds a page', async () => {
    const views = await viewHarness(await settingsOf());
    const [first] = await threeRuns(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));
    const { pool } = busyOnce(views.pool);

    expect(await asOf(views, { pool })(String(first))).toMatchObject({ phase: 'out_of_reach' });
  });

  it('answer nothing for a view the playbook does not keep, or a run it does not have', async () => {
    const views = await viewHarness(await settingsOf());
    const [first] = await threeRuns(views);
    const replayed = asOf(views);
    startedOnPages(views);
    await views.until(morning, foldedAll(3));

    expect(await replayed(String(first), 'workflow/missing')).toBeUndefined();
    expect(await replayed('d3f7e6a0-0000-4000-8000-000000000001')).toBeUndefined();
  });
}

export function replaySuite(settingsOf: SettingsOf): void {
  describe('the views as of a run', () => {
    replayTests(settingsOf);
    endingTests(settingsOf);
    reachTests(settingsOf);
  });
}
