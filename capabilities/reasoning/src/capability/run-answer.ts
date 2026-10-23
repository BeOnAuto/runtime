import { Effect } from 'effect';

import type { StepsAnswer } from '../steps/steps-answer.ts';
import { withTools } from '../tools/tool-opening.ts';
import type { BeforeTheSteps } from './before-the-steps.ts';
import { requestFor } from './definition-request.ts';
import { admitted, type DefinitionRejection } from './model-rejection.ts';
import type { Answering, Stepping } from './run-services.ts';
import { steppedWith } from './steps-run.ts';

export function answerOf(
  answering: Answering,
  { definition, prompt, run, before }: Stepping & { readonly before: BeforeTheSteps },
): Effect.Effect<StepsAnswer, DefinitionRejection> {
  const admission = admitted(answering.languageModel.admit(requestFor(definition, prompt, run)), before);
  const opening = { access: answering.access, references: definition.tools, run, before };
  return Effect.andThen(
    admission,
    withTools(opening, (tools) => steppedWith(answering, { definition, prompt, run }, tools)),
  );
}
