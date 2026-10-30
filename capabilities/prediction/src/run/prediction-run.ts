import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { Effect, Predicate, type Schema } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

export type AskedRun = 'question' | 'build';

export function askedRunOf(input: Schema.Json): AskedRun {
  return Predicate.isObject(input) && !Array.isArray(input) && Object.hasOwn(input, 'build') ? 'build' : 'question';
}

export interface Asking {
  readonly build: (context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly question: (context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
}

export function predictionRun(
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
  asking: Asking,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const asked = askedRunOf(input);
  return checkedInput(input, document.schemas[asked], functionResourceLabels.prediction.singular).pipe(
    Effect.andThen(() => asking[asked](context)),
  );
}
