import { Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { askedRunOf } from './prediction-run.ts';

const { candidatesInABuild, scoringACandidateMs, buildStartMs, questionMs } = predictionBounds;

type Known = 'question' | 'build' | 'unknown';

function knownOf(document: PredictionFunctionDefinitionDocument, input: Schema.Json): Known {
  if (askedRunOf(input) === 'build') {
    return 'build';
  }
  return Result.isSuccess(document.schemas.question.validate(input)) ? 'question' : 'unknown';
}

export function finishesLater(): boolean {
  return true;
}

export function longestRunOf({ source }: PredictionFunctionDefinitionDocument): number {
  return (source?.expiresMs ?? 0) + candidatesInABuild * scoringACandidateMs + buildStartMs;
}

export function finishesLaterFor(document: PredictionFunctionDefinitionDocument, input: Schema.Json): boolean {
  return knownOf(document, input) === 'question' ? false : finishesLater();
}

export function longestRunFor(document: PredictionFunctionDefinitionDocument, input: Schema.Json): number {
  return knownOf(document, input) === 'question' ? questionMs : longestRunOf(document);
}
