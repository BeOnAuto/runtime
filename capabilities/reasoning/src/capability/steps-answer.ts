import { RunCancelled, type IncompleteDetails } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { ToolDefinition } from '../model/model-request.ts';
import type { Stepped } from '../steps/step-loop.ts';
import { answerOfTheSteps, type StepsAnswer } from '../steps/steps-answer.ts';
import { answeredAtALimit, limitEnding, stoppedEnding, unfinishedAfter } from '../tools/tool-endings.ts';
import { afterTheFacts, restartedWithoutContent } from './before-the-steps.ts';
import { recordedRejection, type DefinitionRejection, type RejectionContext } from './model-rejection.ts';
import type { AnsweredRun } from './spending-record.ts';

const outcomeUnknown =
  'The server restarted while the run called a tool that may change something, so whether that call did is not known';

const cutOffAtItsLength: IncompleteDetails = { reason: 'max_output_tokens' };

type Answered = Extract<Stepped['ending'], { readonly type: 'answered' }>;

type TurnLimits = Parameters<typeof answeredAtALimit>[1];

function incompleteDetailsOf(
  state: Stepped['state'],
  { data }: Answered,
  { output }: ReasoningFunctionDefinitionDocument,
  limits: TurnLimits,
): IncompleteDetails | undefined {
  if (state.lastFinal) {
    return answeredAtALimit(state, limits);
  }
  return data.finish_reason === 'length' && output.type === 'text' ? cutOffAtItsLength : undefined;
}

function markedBy(answer: StepsAnswer, incomplete: IncompleteDetails | undefined): AnsweredRun {
  return incomplete === undefined ? answer : { ...answer, incomplete_details: incomplete };
}

export function stepsAnswerOf(
  definition: ReasoningFunctionDefinitionDocument,
  { state, ending }: Stepped,
  tools: readonly ToolDefinition[],
  limits: TurnLimits,
): Effect.Effect<AnsweredRun, DefinitionRejection> {
  const { use, spent } = afterTheFacts(state.facts, state.serversEnded);
  const context: RejectionContext = {
    maxOutputTokens: definition.settings.max_output_tokens,
    spent,
    use,
    lastInputTokens: state.meter.lastInputTokens,
    answeredBytes: state.answeredBytes,
  };
  if (ending.type === 'answered') {
    return Result.match(
      answerOfTheSteps(state, ending, { model: definition.model, output: definition.output, tools }),
      {
        onSuccess: (answer) => Effect.succeed(markedBy(answer, incompleteDetailsOf(state, ending, definition, limits))),
        onFailure: (failed) => recordedRejection(failed, context),
      },
    );
  }
  if (ending.type === 'failed') {
    return recordedRejection(ending.data, context);
  }
  if (ending.type === 'stopped') {
    return stoppedEnding(use, ending, spent);
  }
  if (ending.type === 'limit_reached') {
    return limitEnding(use, ending, spent);
  }
  if (ending.type === 'cancelled') {
    return Effect.fail(new RunCancelled({ detail: ending.detail, kind: ending.kind, ...spent }));
  }
  return ending.type === 'outcome_unknown'
    ? unfinishedAfter(use, 'call_outcome_unknown', outcomeUnknown, spent)
    : unfinishedAfter(use, 'restarted_without_content', restartedWithoutContent, spent);
}
