import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { pageViewDetailsOf } from '../views/page-keeping.ts';
import { viewAdded } from '../views/view-statements.ts';
import {
  countingPosts,
  dataOf,
  folds,
  morning,
  pageDetails,
  postsOf,
  reconciledPages,
  startedOnPages,
} from './page-documents.ts';
import { alphaKey, foldedAll, liveAt } from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

function indented(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

const savedAsADefinition = [
  '---',
  `of: ${morning}`,
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    by_channel: categories',
  '  module: |',
  indented(countingPosts),
  '---',
  '{% lately %}',
  '{{ views.by_channel | json }}',
  '{% endlately %}',
  '',
].join('\n');

const savedAsADefinitionDetails: Schema.JsonObject = { of: morning, data: dataOf(countingPosts, 11) };

function keptBefore(views: ViewHarness, version: number, view: Schema.Json) {
  return Effect.runPromise(
    views.store.database.write(
      viewAdded({
        playbookKey: alphaKey,
        name: 'morning-posts',
        version,
        saved: 1,
        details: JSON.stringify(pageViewDetailsOf(savedAsADefinitionDetails)),
        phase: 'live',
        view: JSON.stringify(view),
      }),
    ),
  );
}

function savedAsDefinitionsTests(settingsOf: SettingsOf): void {
  it('of a page saved as a definition of its own are its subject’s, its views renamed and kept as they stood, with the line its fold starts on as the mapping of the page holds it', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', savedAsADefinitionDetails, savedAsADefinition);
    await keptBefore(views, 1, postsOf(40));

    const rows = await reconciledPages(views);
    await views.ranEach(morning, [1, 2]);
    startedOnPages(views);

    expect(rows.map(({ name, version, phase, details }) => [name, version, phase, details.foldLine])).toEqual([
      [morning, 1, 'live', 9],
    ]);
    expect((await views.until(morning, foldedAll(2))).view).toEqual(postsOf(42));
    expect(await views.viewOf('morning-posts')).toBeUndefined();
  });

  it('of a page saved as a definition of its own are built again where the views kept are of another version', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', savedAsADefinitionDetails, savedAsADefinition);
    await keptBefore(views, 2, postsOf(40));
    await views.ranEach(morning, [1, 2]);
    startedOnPages(views);

    expect((await views.until(morning, foldedAll(2))).view).toEqual(postsOf(2));
    expect(await views.gone('morning-posts')).toBe(true);
  });
}

function givingWayTests(settingsOf: SettingsOf): void {
  it('of a page saved as a definition of its own give way to the page key of its subject and to its retirement, and not to a document without a page key', async () => {
    const views = await viewHarness(await settingsOf());
    await views.savedPage('morning-posts', savedAsADefinitionDetails, savedAsADefinition);
    await views.savedPage(
      'evening-posts',
      { of: 'reasoning/evening' },
      savedAsADefinition.replace(morning, 'reasoning/evening'),
    );
    await views.savedPage(
      'noon-posts',
      { of: 'reasoning/noon' },
      savedAsADefinition.replace(morning, 'reasoning/noon'),
    );
    await views.pageSaved(morning, 2, pageDetails(folds("{ by_channel: { values: [{ name: 'X', value: 9 }] } }")));
    await views.subjectRetired('reasoning/evening');
    await views.subjectSaved('reasoning/noon', 2);
    await views.ran(morning, 1);
    startedOnPages(views);

    expect(await views.until(morning, liveAt(2))).toMatchObject({ version: 2 });
    expect(await views.until('reasoning/noon', foldedAll(1))).toMatchObject({ version: 1 });
    expect(await views.viewOf('reasoning/evening')).toBeUndefined();
  });
}

export function carriedPagesSuite(settingsOf: SettingsOf): void {
  describe('the views of a page saved as a definition of its own', () => {
    savedAsDefinitionsTests(settingsOf);
    givingWayTests(settingsOf);
  });
}
