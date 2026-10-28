import { playbookCallerOf } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { fedShapeOf, fittingRuntimeFor, functionShapeOf, runtimeNamed } from '../runtimes/model-runtimes.ts';
import { rowsFileOf } from '../scoring/scoring-inputs.ts';
import type { TrainerAnswer } from '../scoring/version-card.ts';
import { uploadedFitted } from '../trainer/fitted-uploads.ts';
import { aMinute, recordedWork, restingUntil, type Performing } from './build-performing.ts';

interface FittedBy {
  readonly runtime: ReturnType<typeof runtimeNamed> | null;
  readonly candidates: readonly string[];
}

function fittedRecorded(performing: Performing, fitted: FittedBy, detail?: string): Effect.Effect<void> {
  const runtime = fitted.runtime === null ? null : { ...fitted.runtime };
  const data = { runtime, candidates: [...fitted.candidates], ...(detail === undefined ? {} : { detail }) };
  return recordedWork(performing, { type: 'candidates_fitted', data });
}

export function fittingStep(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
): Effect.Effect<void> {
  const { ports, build, now } = performing;
  const runtime = fittingRuntimeFor(ports.runtimes, fedShapeOf(document));
  if (runtime === undefined) {
    return fittedRecorded(performing, { runtime: null, candidates: [] });
  }
  const release = ports.permits.take();
  if (release === null) {
    return restingUntil(performing, now + aMinute);
  }
  const { org, playbook } = build.address;
  const assembled = Option.getOrThrow(Option.fromNullishOr(build.assembled));
  const named = runtimeNamed(runtime);
  return Effect.gen(function* () {
    const path = yield* rowsFileOf(ports, { org, playbook }, assembled.training_sha256);
    const outcome = yield* ports.models.fit(
      runtime,
      { sha256: assembled.training_sha256, path },
      functionShapeOf(document),
    );
    if (outcome.ended === 'busy' || outcome.ended === 'closing' || outcome.ended === 'cancelled') {
      return yield* restingUntil(performing, now + aMinute);
    }
    if (outcome.ended !== 'answered') {
      const detail = 'detail' in outcome ? outcome.detail : `its fit ended ${outcome.ended}`;
      return yield* fittedRecorded(performing, { runtime: named, candidates: [] }, detail);
    }
    const uploading = { ports, build, document };
    const uploaded = yield* Effect.forEach(outcome.answer.models, (model) => uploadedFitted(uploading, model));
    if (uploaded.some((each) => 'busy' in each)) {
      return yield* restingUntil(performing, now + aMinute);
    }
    const candidates = uploaded.flatMap((each) => ('sha256' in each ? [each.sha256] : []));
    return yield* fittedRecorded(performing, { runtime: named, candidates });
  }).pipe(Effect.ensuring(Effect.sync(release)));
}

export function fittedAnswerOf({ build }: Performing, candidates: readonly string[]): TrainerAnswer {
  const { id, name } = playbookCallerOf(build.address);
  return { candidates: [...candidates], by: { id, name } };
}
