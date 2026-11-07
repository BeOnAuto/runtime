import type { RunTools } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { outputDocumentOf } from '../jobs/compiled-request.ts';
import { keptIn } from '../steps/kept-content.ts';
import { answeredByTheSteps } from '../steps/run-steps.ts';
import { stepToolsOf, type StepRecording } from '../steps/step-run.ts';
import { boundsFor, requestBaseOf, unknownWindows } from './definition-request.ts';
import type { Answering, Stepping } from './run-services.ts';
import { stepsAnswerOf } from './steps-answer.ts';

export function stepRecordingOf(
  { content, reading = unknownWindows }: Pick<Answering, 'content' | 'reading'>,
  { definition, run }: Pick<Stepping, 'definition' | 'run'>,
  tools: RunTools | undefined,
): Effect.Effect<StepRecording> {
  return Effect.map(boundsFor(definition, reading, tools !== undefined), (bounds) => ({
    model: definition.model,
    base: { ...requestBaseOf(definition, run), output: outputDocumentOf(definition.output) },
    tools: stepToolsOf(tools),
    bounds,
    journal: run.journal,
    kept: tools === undefined || tools.keepsContent ? keptIn(content, run) : undefined,
    startedAt: Date.parse(run.journal.attempt.startedAt),
  }));
}

export function steppedWith(answering: Answering, stepping: Stepping, tools: RunTools | undefined) {
  return Effect.gen(function* () {
    const recording = yield* stepRecordingOf(answering, stepping, tools);
    const steps = { ...recording, perform: answering.perform(tools?.offered ?? []) };
    const stepped = yield* answeredByTheSteps(steps, stepping.prompt, stepping.run.journal.attempt);
    return yield* stepsAnswerOf(stepping.definition, stepped, recording.tools.definitions);
  });
}
