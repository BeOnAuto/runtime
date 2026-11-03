import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { KeptViewState, KeptViews } from '../capability/view-standing.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { subjectPagesOf } from '../page/subject-pages.ts';

const checkingNothing: Pick<ProgramPool, 'check'> = {
  check: () => Promise.resolve({ ran: 'checked', issues: [], stripped: { expressions: [] }, milliseconds: 0 }),
};

export const keepingNoViews: KeptViews = {
  viewOf: () => Effect.undefined,
  newestRecordAt: () => Effect.undefined,
  viewAsOfRun: () => Effect.undefined,
};

export function keepingTheViews(kept: KeptViewState, asOfRun: KeptViewState = kept): KeptViews {
  return {
    viewOf: () => Effect.succeed(kept),
    newestRecordAt: () => Effect.succeed('2026-11-01T09:00:00.000Z'),
    viewAsOfRun: () => Effect.succeed(asOfRun),
  };
}

export function pagesOver(views: KeptViews): SubjectPages {
  return subjectPagesOf({ pool: checkingNothing, views });
}

export const uncheckedPages = pagesOver(keepingNoViews);
