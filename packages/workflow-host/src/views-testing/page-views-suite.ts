import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import {
  countingPosts,
  folds,
  morning,
  pageDetails,
  postsOf,
  reconciledPages,
  startedOnPages,
} from './page-documents.ts';
import { foldedAll, isStalled, liveAt } from './view-documents.ts';
import { viewHarness } from './view-harness.ts';

function foldingTests(settingsOf: SettingsOf): void {
  it('are folded from the playbook’s history, kept under the type and the name of the page’s subject', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(countingPosts));
    await views.ranEach(morning, [1, 2]);
    startedOnPages(views);

    const page = await views.until(morning, foldedAll(2));

    expect(page.view).toEqual(postsOf(2));
  });

  it('go on folding while the page’s subject is paused, as a run it started before goes on', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(countingPosts));
    await views.ran(morning, 1);
    startedOnPages(views);
    await views.until(morning, foldedAll(1));

    await views.subjectPaused(morning);
    await views.ran(morning, 2);

    expect((await views.until(morning, foldedAll(2))).view).toEqual(postsOf(2));
  });

  it('are kept for the playbook’s page under the playbook’s name', async () => {
    const views = await viewHarness(await settingsOf());
    await views.playbookPageSaved(pageDetails(countingPosts));
    await views.ranEach(morning, [1]);
    startedOnPages(views);

    expect((await views.until('playbook/alpha', foldedAll(1))).view).toEqual(postsOf(1));
  });
}

function shapeAndOrderTests(settingsOf: SettingsOf): void {
  it('stall with the kind shape at a view that does not match its shape, or that data.views does not declare', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved('workflow/wrong-shape', 1, pageDetails(folds('{ by_channel: { lines: [] } }')));
    await views.pageSaved('workflow/undeclared', 1, pageDetails(folds('{ by_week: null }')));
    await views.ran(morning, 1);
    startedOnPages(views);

    const [wrong, undeclared] = await Promise.all([
      views.until('workflow/wrong-shape', isStalled),
      views.until('workflow/undeclared', isStalled),
    ]);

    expect([wrong.stall?.kind, String(wrong.stall?.message).startsWith('/by_channel')]).toEqual(['shape', true]);
    expect(undeclared.stall).toMatchObject({
      kind: 'shape',
      message: 'The fold returned by_week, which data.views does not declare',
    });
  });

  it('build as many at once as the folder may, the others waiting in the order they were saved', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(countingPosts));
    await views.pageSaved('reasoning/evening-posts', 1, pageDetails(countingPosts));

    const rows = await reconciledPages(views, 1);

    expect(rows.map(({ name, phase }) => [name, phase])).toEqual([
      [morning, 'rebuilding'],
      ['reasoning/evening-posts', 'waiting'],
    ]);
  });
}

function versionTests(settingsOf: SettingsOf): void {
  it('are built again when the data of the page changes, and never for a new version of its subject alone', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(countingPosts));
    await views.ran(morning, 1);
    startedOnPages(views);
    await views.until(morning, foldedAll(1));

    await views.pageSaved(morning, 2, pageDetails(countingPosts));
    expect((await reconciledPages(views)).map(({ name, version, phase }) => [name, version, phase])).toEqual([
      [morning, 1, 'live'],
    ]);

    await views.pageSaved(morning, 3, pageDetails(folds("{ by_channel: { values: [{ name: 'X', value: 9 }] } }")));

    expect((await views.until(morning, liveAt(3))).view).toEqual({ by_channel: { values: [{ name: 'X', value: 9 }] } });
  });

  it('are dropped when the page keeps no data, is removed, or its subject is retired', async () => {
    const views = await viewHarness(await settingsOf());
    await views.pageSaved(morning, 1, pageDetails(countingPosts));
    await views.pageSaved('reasoning/evening-posts', 1, pageDetails(countingPosts));
    await views.pageSaved('computation/totals', 1, pageDetails(countingPosts));
    await views.playbookPageSaved(pageDetails(countingPosts));
    await views.ran(morning, 1);
    startedOnPages(views);
    await views.until(morning, foldedAll(1));

    await views.pageSaved(morning, 2, {});
    await views.pageRemoved('reasoning/evening-posts', 2);
    await views.subjectRetired('computation/totals');
    await views.playbookPageRemoved();

    expect(
      await Promise.all(
        [morning, 'reasoning/evening-posts', 'computation/totals', 'playbook/alpha'].map((name) => views.gone(name)),
      ),
    ).toEqual([true, true, true, true]);
  });
}

export function pageViewsSuite(settingsOf: SettingsOf): void {
  describe('the views of a page', () => {
    foldingTests(settingsOf);
    shapeAndOrderTests(settingsOf);
    versionTests(settingsOf);
  });
}
