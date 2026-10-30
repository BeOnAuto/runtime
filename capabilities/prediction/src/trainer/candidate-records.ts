import { workRecorder, type WorkRule } from '@on.auto/definitions';
import { Conflict, InvalidInput } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { correlationOf, type BuildState } from '../builds/build-state.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { buildWorkIn } from '../facts/build-facts.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';
import type { Checked } from './candidate-checks.ts';

const alreadyUploaded = new Conflict({ detail: 'The candidate was uploaded to the build meanwhile' });

const fullBuild = new Conflict({
  detail: `The build took its ${predictionBounds.candidatesInABuild} candidates meanwhile`,
});

const recordsAgainAtMost = 3;

function changedMeanwhile(error: unknown): boolean {
  return error instanceof Conflict && error.kind === 'concurrent_change';
}

function wasAlreadyUploaded(error: unknown): boolean {
  return error === alreadyUploaded;
}

function uploadRule(sha256: string): WorkRule {
  return ({ work }) => {
    const uploads = work
      .flatMap((each) => buildWorkIn(each))
      .flatMap((fact) => (fact.type === 'candidate_uploaded' ? [fact.data.sha256] : []));
    if (uploads.includes(sha256)) {
      return alreadyUploaded;
    }
    return uploads.length >= predictionBounds.candidatesInABuild ? fullBuild : undefined;
  };
}

function recorded(
  ports: PredictionPorts,
  build: BuildState,
  fact: { readonly type: string; readonly data: Schema.JsonObject },
  rule?: WorkRule,
) {
  const record = workRecorder(ports.ledger, buildRunFacts);
  return Effect.flatMap(correlationOf(ports.ledger, build.address), (correlationId) =>
    record(build.address, { type: 'work', fact }, { causationId: null, correlationId }, rule).pipe(
      Effect.retry({ times: recordsAgainAtMost, while: changedMeanwhile }),
    ),
  );
}

export function recordedRefusal(
  ports: PredictionPorts,
  build: BuildState,
  checked: Extract<Checked, { readonly refused: unknown }>,
) {
  const { sha256, bytes, because, detail } = checked.refused;
  return Effect.andThen(
    recorded(ports, build, { type: 'candidate_refused', data: { sha256, bytes, because, detail } }),
    Effect.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail: `${because}: ${detail}` }] })),
  );
}

export function recordedUpload(
  ports: PredictionPorts,
  build: BuildState,
  checked: Extract<Checked, { readonly uploaded: unknown }>,
) {
  const { uploaded } = checked;
  return checked.already
    ? Effect.succeed(false)
    : recorded(ports, build, { type: 'candidate_uploaded', data: uploaded }, uploadRule(uploaded.sha256)).pipe(
        Effect.as(true),
        Effect.catchIf(wasAlreadyUploaded, () => Effect.succeed(false)),
      );
}
