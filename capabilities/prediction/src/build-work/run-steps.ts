import { Option } from 'effect';

import { asksATrainer, buildRecordOf } from '../builds/build-state.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { endingStep } from '../scoring/ending-steps.ts';
import { scoredCandidate } from '../scoring/scoring-step.ts';
import type { TrainerAnswer } from '../scoring/version-card.ts';
import { restingUntil, type Performing, type PerformedStep } from './build-performing.ts';
import { fittedAnswerOf, fittingStep } from './fitted-candidates.ts';
import { throughAChild } from './request-child.ts';
import { trainerAnswerOf } from './trainer-answers.ts';

function scored(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  answer: TrainerAnswer,
): PerformedStep {
  const { build } = performing;
  const assembled = Option.getOrThrow(Option.fromNullishOr(build.assembled));
  const next = answer.candidates.find((sha256) => !build.decided.has(sha256));
  const scoredBuild = { document, assembled };
  return next === undefined
    ? endingStep(performing, scoredBuild, answer)
    : scoredCandidate(performing, scoredBuild, next);
}

function fittedScoring(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const { fitted } = performing.build;
  return fitted === undefined
    ? fittingStep(performing, document)
    : scored(performing, document, fittedAnswerOf(performing, fitted.candidates));
}

function scoring(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  answer: TrainerAnswer,
): PerformedStep {
  return answer.candidates.length === 0 ? fittedScoring(performing, document) : scored(performing, document, answer);
}

export function duringTheRun(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const { run } = performing.build;
  const record = Option.getOrThrow(Option.fromNullishOr(buildRecordOf(run)));
  if (!asksATrainer(record)) {
    return fittedScoring(performing, document);
  }
  if (record.waiting_for !== undefined) {
    return throughAChild(performing, document, record, (answer) => scoring(performing, document, answer));
  }
  return run.answer === null
    ? restingUntil(performing, null)
    : scoring(performing, document, trainerAnswerOf(run.answer));
}
