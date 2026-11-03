import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { KeptViews } from '../capability/view-standing.ts';
import { pageCheckOn } from './page-content.ts';
import { withoutThePage } from './page-lines.ts';
import { pageAsOfRun, pageViewsOf } from './page-presenting.ts';
import { placedOf, resultOf } from './placed-pages.ts';
import { playbookPageSaved } from './playbook-pages.ts';
import { presentedOf, writtenPlaybookPageOf } from './presented-pages.ts';
import type { DefinitionSubject, PageSubject, SubjectPages } from './subject-pages-port.ts';

export type { PageContent, SubjectPage } from './page-facts.ts';

export {
  playbookSubject,
  type DefinitionSubject,
  type PageOf,
  type PageSubject,
  type ResultOver,
  type SubjectPages,
} from './subject-pages-port.ts';

export interface SubjectPagesOptions {
  readonly pool: Pick<ProgramPool, 'check'>;
  readonly views: KeptViews;
}

const pageOf = Effect.fnUntraced(function* (type: string, name: string) {
  const presented = yield* presentedOf(type, name);
  return presented?.page;
});

const playbookPageOf = Effect.fnUntraced(function* () {
  const written = yield* writtenPlaybookPageOf();
  return written?.page;
});

function viewsOn(views: KeptViews) {
  return Effect.fnUntraced(function* (subject: PageSubject) {
    const placed = yield* placedOf(subject);
    return placed === undefined ? {} : yield* pageViewsOf(views, placed);
  });
}

function asOfRunOn(views: KeptViews) {
  return Effect.fnUntraced(function* (subject: DefinitionSubject, run: string) {
    const placed = yield* placedOf(subject);
    return placed === undefined ? {} : yield* pageAsOfRun(views, placed, run);
  });
}

export function subjectPagesOf({ pool, views }: SubjectPagesOptions): SubjectPages {
  return {
    check: pageCheckOn(pool),
    withoutThePage,
    pageOf,
    playbookPageOf,
    resultOf,
    viewsOf: viewsOn(views),
    asOfRun: asOfRunOn(views),
    savePlaybookPage: playbookPageSaved,
  };
}
