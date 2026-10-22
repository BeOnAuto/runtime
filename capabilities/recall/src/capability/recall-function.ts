import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  type Capability,
} from '@on.auto/definitions';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { ViewsPort } from '@on.auto/workflow-host';

import { documentCheck } from '../document/document-check.ts';
import { recallBounds, recallDefinitionType } from '../run/recall-bounds.ts';
import { recallRun } from '../run/recall-run.ts';
import { parse, summarize } from './recall-definitions.ts';
import { recallStanding } from './recall-standing.ts';

export interface RecallFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly mostFunctions?: number;
  readonly deadlineMs?: number;
  readonly budget?: number;
  readonly memoryBytes?: number;
}

export function makeRecallFunctionAdapter({
  pool,
  views,
  mostFunctions = recallBounds.mostFunctions,
  deadlineMs = recallBounds.deadlineMs,
  budget = recallBounds.budget,
  memoryBytes = recallBounds.answerMemoryBytes,
}: RecallFunctionAdapterOptions): Capability {
  const run = recallRun({ pool, views, deadlineMs, budget, memoryBytes });
  return defineCapability({
    type: recallDefinitionType,
    title: functionCategoryLabels.recall,
    guide: { name: 'recall-function' },
    noun: { one: functionResourceLabels.recall.singular, other: functionResourceLabels.recall.plural },
    describeOutput: outputInWords('result'),
    mediaType: 'text/markdown',
    parse,
    check: documentCheck(pool),
    summarize,
    run: (document, input, context, stripped) => run({ document, program: stripped.module }, input, context),
    longestAnyRunMs: deadlineMs,
    mostActive: mostFunctions,
    standing: recallStanding(views),
  });
}
