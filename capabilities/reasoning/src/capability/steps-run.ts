import type { RunTools } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { approvalStepsOf } from '../approvals/approval-steps.ts';
import { outputDocumentOf } from '../jobs/compiled-request.ts';
import { keptIn } from '../steps/kept-content.ts';
import { stepToolsOf, type StepRecording } from '../steps/step-run.ts';
import { boundsFor, requestBaseOf, unknownWindows } from './definition-request.ts';
import type { Answering, Stepping } from './run-services.ts';

export function stepRecordingOf(
  { content, reading = unknownWindows, approvals = {} }: Pick<Answering, 'content' | 'reading' | 'approvals'>,
  { definition, run }: Pick<Stepping, 'definition' | 'run'>,
  tools: RunTools | undefined,
): Effect.Effect<StepRecording> {
  const { attempt } = run.journal;
  return Effect.zipWith(
    boundsFor(definition, reading, tools !== undefined),
    approvalStepsOf(approvals, run, tools),
    (bounds, approvalSteps) => ({
      model: definition.model,
      approvals: approvalSteps,
      base: { ...requestBaseOf(definition, run), output: outputDocumentOf(definition.output) },
      tools: stepToolsOf(tools),
      bounds,
      journal: run.journal,
      kept: tools === undefined || tools.keepsContent ? keptIn(content, run) : undefined,
      startedAt: Date.parse(attempt.startedAt) + (attempt.waitedMs ?? 0),
    }),
  );
}
