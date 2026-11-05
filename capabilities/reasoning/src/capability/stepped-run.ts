import type { FinishesLater } from '@on.auto/definitions';
import type { RunTools } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { deferredFor } from '../approvals/approval-steps.ts';
import { answeredByTheSteps } from '../steps/run-steps.ts';
import type { StepsAnswer } from '../steps/steps-answer.ts';
import type { DefinitionRejection } from './model-rejection.ts';
import type { Answering, Stepping } from './run-services.ts';
import { stepsAnswerOf } from './steps-answer.ts';
import { stepRecordingOf } from './steps-run.ts';

export function steppedWith(
  answering: Answering,
  stepping: Stepping,
  tools: RunTools | undefined,
): Effect.Effect<StepsAnswer | FinishesLater, DefinitionRejection> {
  return Effect.gen(function* () {
    const recording = yield* stepRecordingOf(answering, stepping, tools);
    const steps = { ...recording, perform: answering.perform(tools?.offered ?? []) };
    const stepped = yield* answeredByTheSteps(steps, stepping.prompt, stepping.run.journal.attempt);
    const answered = yield* stepsAnswerOf(stepping.definition, stepped, recording.tools.definitions);
    return 'waits' in answered
      ? yield* deferredFor({ run: stepping.run, state: stepped.state, approval: answered.waits, spent: answered.spent })
      : answered;
  });
}
