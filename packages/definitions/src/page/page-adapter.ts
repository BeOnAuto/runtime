import { InvalidInput } from '@on.auto/operations';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { defineCapability } from '../capability/capability.ts';
import type { DefinitionKind } from '../capability/definition-kinds.ts';
import type { KeptViews } from '../capability/view-standing.ts';
import { pageChecked } from './page-check.ts';
import { invalidPage, parse, summarize } from './page-definitions.ts';
import { pagePresenting, pageStanding } from './page-presenting.ts';
import { pageDefinitionType } from './page-subjects.ts';

export const pageNeverRuns = 'A page never runs: run its subject, and read the run with get_run';

const neverRun = new InvalidInput({ detail: pageNeverRuns, issues: [{ pointer: '/type', detail: pageNeverRuns }] });

export interface PageAdapterOptions {
  readonly pool: Pick<ProgramPool, 'check'>;
  readonly views: KeptViews;
}

export function makePageAdapter({ pool, views }: PageAdapterOptions): DefinitionKind {
  const capability = defineCapability({
    type: pageDefinitionType,
    title: 'Page',
    guide: { name: 'page' },
    noun: { one: 'page', other: 'pages' },
    describeOutput: () => 'A page never runs, so it has no output.',
    mediaType: 'text/markdown',
    parse,
    check: pageChecked(pool, invalidPage),
    summarize,
    run: () => Effect.fail(neverRun),
    standing: pageStanding(views),
  });
  return {
    ...capability,
    neverRuns: pageNeverRuns,
    presents: pagePresenting(views),
  };
}
