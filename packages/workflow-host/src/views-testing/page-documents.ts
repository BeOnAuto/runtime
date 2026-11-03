import { checkedWorker } from '@on.auto/definitions';
import { Effect, type Schema } from 'effect';

import { someFolder } from '../projector/folder.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { reconciledRows } from '../projector/reconciled-rows.ts';
import { pageViewsFolder } from '../views/page-views.ts';
import { alphaKey, foldingOf } from './view-documents.ts';
import type { ViewHarness } from './view-harness.ts';

export const countingPosts = [
  'export function fold(view, event) {',
  '  const posts = (view.by_channel?.values[0]?.value ?? 0) + 1;',
  "  return { by_channel: { unit: 'posts', values: [{ name: 'LinkedIn', value: posts }] } };",
  '}',
].join('\n');

const byChannel: Schema.JsonObject = { by_channel: 'categories' };

const checkedFolding = { ...foldingOf(), worker: checkedWorker };

export const morning = 'workflow/morning-social-content';

export function dataOf(fold: string, foldLine = 14): Schema.JsonObject {
  return { views: byChannel, language: 'typescript', fold, foldLine, filters: [{ type: 'run_succeeded' }] };
}

export function pageDetails(fold: string): Schema.JsonObject {
  return { data: dataOf(fold) };
}

export function postsOf(value: number): Schema.Json {
  return { by_channel: { unit: 'posts', values: [{ name: 'LinkedIn', value }] } };
}

export function startedOnPages(views: ViewHarness) {
  return views.start({
    views: someFolder(pageViewsFolder({ pool: views.pool, rebuildsAtOnce: 4, folding: checkedFolding })),
  });
}

export function folds(returned: string): string {
  return `export function fold(view, event) {\n  return ${returned};\n}`;
}

export function reconciledPages(views: ViewHarness, rebuildsAtOnce = 4) {
  const kept = { database: views.store.database, definitions: definitionsByType().of };
  const folder = pageViewsFolder({ pool: views.pool, rebuildsAtOnce, folding: checkedFolding });
  return Effect.runPromise(reconciledRows(folder, kept, alphaKey));
}
