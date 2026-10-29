import { playbookCallerOf } from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect, Option } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import {
  fedShapeOf,
  fittingRuntimeFor,
  functionShapeOf,
  licensedFor,
  runtimeNamed,
} from '../runtimes/model-runtimes.ts';
import { rowsFileOf } from '../scoring/scoring-inputs.ts';
import type { TrainerAnswer } from '../scoring/version-card.ts';
import { uploadedFitted } from '../trainer/fitted-uploads.ts';
import { aMinute, recordedWork, restingUntil, type Performing, type PerformedStep } from './build-performing.ts';

interface FittedBy {
  readonly runtime: ReturnType<typeof runtimeNamed> | null;
  readonly candidates: readonly string[];
}

function fittedRecorded(performing: Performing, fitted: FittedBy, detail?: string): Effect.Effect<void> {
  const runtime = fitted.runtime === null ? null : { ...fitted.runtime };
  const data = { runtime, candidates: [...fitted.candidates], ...(detail === undefined ? {} : { detail }) };
  return recordedWork(performing, { type: 'candidates_fitted', data });
}

function fittedBy(
  performing: Performing,
  document: PredictionFunctionDefinitionDocument,
  runtime: ModelRuntime,
): PerformedStep {
  const { ports, build, now } = performing;
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
      org,
      runtime,
      { sha256: assembled.training_sha256, path },
      functionShapeOf(document),
    );
    if (outcome.ended === 'busy' || outcome.ended === 'closing' || outcome.ended === 'cancelled') {
      return yield* restingUntil(performing, now + aMinute);
    }
    if (outcome.ended === 'unlicensed') {
      const which = `${runtime.name} needs to fit the models of this function`;
      const { detail } = yield* ports.features.refusal({ org, feature: outcome.feature, which });
      return yield* fittedRecorded(performing, { runtime: named, candidates: [] }, detail);
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

export function fittingStep(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const licensed = licensedFor(performing.ports, performing.build.address.org);
  return Effect.flatMap(fittingRuntimeFor(licensed, fedShapeOf(document)), (runtime) =>
    runtime === undefined
      ? fittedRecorded(performing, { runtime: null, candidates: [] })
      : fittedBy(performing, document, runtime),
  );
}

export function fittedAnswerOf({ build }: Performing, candidates: readonly string[]): TrainerAnswer {
  const { id, name } = playbookCallerOf(build.address);
  return { candidates: [...candidates], by: { id, name } };
}
