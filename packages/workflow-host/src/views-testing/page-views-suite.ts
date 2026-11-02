import { checkedWorker } from '@on.auto/definitions';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { someFolder } from '../projector/folder.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { reconciledRows } from '../projector/reconciled-rows.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { pageViewsFolder } from '../views/page-views.ts';
import { alphaKey, foldedAll, foldingOf, isStalled, liveAt } from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

const countingPosts = [
  'export function fold(view, event) {',
  '  const posts = (view.by_channel?.values[0]?.value ?? 0) + 1;',
  "  return { by_channel: { unit: 'posts', values: [{ name: 'LinkedIn', value: posts }] } };",
  '}',
].join('\n');

const byChannel: Schema.JsonObject = { by_channel: 'categories' };

const checkedFolding = { ...foldingOf(), worker: checkedWorker };

function pageDetails(fold: string): Schema.JsonObject {
  return {
    of: 'workflow/morning-social-content',
    data: { views: byChannel, language: 'typescript', fold, foldLine: 14, filters: [{ type: 'run_succeeded' }] },
  };
}

function started(views: ViewHarness) {
  return views.start({
    views: someFolder(pageViewsFolder({ pool: views.pool, rebuildsAtOnce: 4, folding: checkedFolding })),
  });
}

function folds(returned: string): string {
  return `export function fold(view, event) {\n  return ${returned};\n}`;
}

function reconciledPages(views: ViewHarness, rebuildsAtOnce: number) {
  const kept = { database: views.store.database, definitions: definitionsByType().of };
  const folder = pageViewsFolder({ pool: views.pool, rebuildsAtOnce, folding: checkedFolding });
  return Effect.runPromise(reconciledRows(folder, kept, alphaKey));
}

function foldingTests(settingsOf: SettingsOf): void {
  it('are folded from the playbook’s history, kept under the page’s name', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', pageDetails(countingPosts));
    await views.ranEach('workflow/morning-social-content', [1, 2]);
    started(views);

    const page = await views.until('morning-posts', foldedAll(2));

    expect(page.view).toEqual({ by_channel: { unit: 'posts', values: [{ name: 'LinkedIn', value: 2 }] } });
  });

  it('stall with the kind shape at a view that does not match its shape, or that data.views does not declare', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('wrong-shape', pageDetails(folds('{ by_channel: { lines: [] } }')));
    await views.savedPage('undeclared', pageDetails(folds('{ by_week: null }')));
    await views.ran('workflow/morning-social-content', 1);
    started(views);

    const [wrong, undeclared] = await Promise.all([
      views.until('wrong-shape', isStalled),
      views.until('undeclared', isStalled),
    ]);

    expect([wrong.stall?.kind, String(wrong.stall?.message).startsWith('/by_channel')]).toEqual(['shape', true]);
    expect(undeclared.stall).toMatchObject({
      kind: 'shape',
      message: 'The fold returned by_week, which data.views does not declare',
    });
  });

  it('build as many at once as the folder may, the others waiting in the order they were saved', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', pageDetails(countingPosts));
    await views.savedPage('evening-posts', pageDetails(countingPosts));

    const rows = await reconciledPages(views, 1);

    expect(rows.map(({ name, phase }) => [name, phase])).toEqual([
      ['morning-posts', 'rebuilding'],
      ['evening-posts', 'waiting'],
    ]);
  });
}

function versionTests(settingsOf: SettingsOf): void {
  it('are built again for a new version', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', pageDetails(countingPosts));
    await views.ran('workflow/morning-social-content', 1);
    started(views);
    await views.until('morning-posts', foldedAll(1));

    await views.savedPage('morning-posts', pageDetails(folds("{ by_channel: { values: [{ name: 'X', value: 9 }] } }")));

    expect((await views.until('morning-posts', liveAt(2))).view).toEqual({
      by_channel: { values: [{ name: 'X', value: 9 }] },
    });
  });

  it('are dropped when the page keeps no data or is retired', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', pageDetails(countingPosts));
    await views.savedPage('playbook-page', pageDetails(countingPosts));
    await views.ran('workflow/morning-social-content', 1);
    started(views);
    await views.until('morning-posts', foldedAll(1));

    await views.savedPage('morning-posts', { of: 'workflow/morning-social-content' });
    await views.retiredPage('playbook-page');

    expect(await Promise.all([views.gone('morning-posts'), views.gone('playbook-page')])).toEqual([true, true]);
  });
}

export function pageViewsSuite(settingsOf: SettingsOf): void {
  describe('the views of a page', () => {
    foldingTests(settingsOf);
    versionTests(settingsOf);
  });
}
