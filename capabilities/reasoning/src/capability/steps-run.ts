import type { RunTools } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { outputDocumentOf } from '../jobs/compiled-request.ts';
import { keptIn } from '../steps/kept-content.ts';
import { answeredByTheSteps } from '../steps/run-steps.ts';
import { stepToolsOf } from '../steps/step-run.ts';
import { boundsFor, requestBaseOf, unknownWindows } from './definition-request.ts';
import type { Answering, Stepping } from './run-services.ts';
import { stepsAnswerOf } from './steps-answer.ts';

export function steppedWith(
  { content, perform, reading = unknownWindows }: Answering,
  { definition, prompt, run }: Stepping,
  tools: RunTools | undefined,
) {
  return Effect.gen(function* () {
    const stepTools = stepToolsOf(tools);
    const steps = {
      model: definition.model,
      base: { ...requestBaseOf(definition, run), output: outputDocumentOf(definition.output) },
      tools: stepTools,
      bounds: yield* boundsFor(definition, reading, tools !== undefined),
      journal: run.journal,
      kept: tools === undefined || tools.keepsContent ? keptIn(content, run) : undefined,
      perform: perform(tools?.offered ?? []),
      startedAt: Date.parse(run.journal.attempt.startedAt),
    };
    const stepped = yield* answeredByTheSteps(steps, prompt, run.journal.attempt);
    return yield* stepsAnswerOf(definition, stepped, stepTools.definitions);
  });
}
