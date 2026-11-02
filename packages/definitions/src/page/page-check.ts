import type { InvalidInput, Unavailable } from '@on.auto/operations';
import type { CheckIssue, CheckJob, ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { noStrippedForms, type StrippedForms } from '../capability/stripped-forms.ts';
import { reportedIssues, type DocumentIssue } from '../document/document-issue.ts';
import { checkedAtSave } from '../program-check/save-check.ts';
import { shapedViewsSchemaOf } from '../shapes/shaped-views.ts';
import type { PageData, PageDefinitionDocument } from './page-document.ts';

const filterNames = ['$data'];

function jobOf({ fold, views, filterExpressions }: PageData): CheckJob {
  return {
    module: { place: 'page', source: fold },
    schemas: { view: shapedViewsSchemaOf(views) },
    expressions: filterExpressions.map(({ source }) => ({ source, names: filterNames })),
  };
}

function placedIssues({ foldLine, filterExpressions }: PageData, issues: readonly CheckIssue[]) {
  const ofModule = issues
    .filter(({ at }) => at === 'module')
    .map(({ line, detail }): DocumentIssue => ({ line: foldLine + line - 1, pointer: '', detail }));
  const ofFilters = filterExpressions.flatMap(({ pointer, line: first }, index) =>
    issues
      .filter(({ at }) => at === index)
      .map(({ line, detail }): DocumentIssue => ({ line: first + line - 1, pointer, detail })),
  );
  return reportedIssues([...ofModule, ...ofFilters]);
}

export function pageChecked(
  pool: Pick<ProgramPool, 'check'>,
  refused: (issues: readonly DocumentIssue[]) => InvalidInput,
): (document: PageDefinitionDocument) => Effect.Effect<StrippedForms, InvalidInput | Unavailable> {
  return ({ data }) =>
    data === undefined
      ? Effect.succeed(noStrippedForms)
      : checkedAtSave(pool, jobOf(data)).pipe(
          Effect.flatMap((checked) =>
            'stripped' in checked
              ? Effect.succeed(checked.stripped)
              : Effect.fail(refused(placedIssues(data, checked.issues))),
          ),
        );
}
