import { contentOfBytes, sha256Of, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { FittedAnswer } from '../model-processes/model-processes.ts';
import { fedShapeOf, formatsOfferedFor, licensedFor, executesFormat } from '../runtimes/model-runtimes.ts';
import { checkedCandidate, receivedCandidate, type Checked } from './candidate-checks.ts';
import { recordedRefusal, recordedUpload } from './candidate-records.ts';
import { staged, stagedUnlessItIs } from './candidate-staging.ts';

export type FittedUpload = { readonly sha256: string } | { readonly busy: true } | { readonly refused: true };

const busy: FittedUpload = { busy: true };

const refused: FittedUpload = { refused: true };

export interface FittedUploading {
  readonly ports: PredictionPorts;
  readonly build: BuildState;
  readonly document: PredictionFunctionDefinitionDocument;
}

function refusedUpload(): Effect.Effect<FittedUpload> {
  return Effect.succeed(refused);
}

interface Lacking {
  readonly sha256: string;
  readonly bytes: number;
  readonly feature: string;
  readonly format: string;
}

function unlicensedRefusalOf(
  { sha256, bytes }: Pick<Lacking, 'sha256' | 'bytes'>,
  detail: string,
): Extract<Checked, { readonly refused: unknown }> {
  return { refused: { sha256, bytes, because: 'feature_unlicensed', detail } };
}

function recordedUnlicensed({ ports, build }: FittedUploading, lacking: Lacking) {
  const { feature, format } = lacking;
  return Effect.flatMap(
    ports.features.refusal({ org: build.address.org, feature, which: executesFormat(format) }),
    ({ detail }: Readonly<{ detail: string }>) => recordedRefusal(ports, build, unlicensedRefusalOf(lacking, detail)),
  );
}

export function uploadedFitted(
  uploading: FittedUploading,
  { format, bytes }: FittedAnswer,
): Effect.Effect<FittedUpload, Unavailable> {
  const { ports, build, document } = uploading;
  return Effect.gen(function* () {
    const offered = yield* formatsOfferedFor(licensedFor(ports, build.address.org), fedShapeOf(document));
    const chosen = offered.accepted.find((each) => each.format === format);
    const lacking = offered.unlicensed.find((each) => each.format === format);
    if (lacking !== undefined) {
      const sha256 = sha256Of(bytes);
      return yield* recordedUnlicensed(uploading, { sha256, bytes: bytes.length, feature: lacking.feature, format });
    }
    if (chosen === undefined) {
      return refused;
    }
    const checking = { build, document, chosen };
    const file = yield* receivedCandidate(ports, checking, contentOfBytes(bytes, 'application/octet-stream').stream);
    const checked = yield* checkedCandidate(ports, checking, file).pipe(
      Effect.catchTag('conflict', ({ detail }: Readonly<{ detail: string }>) =>
        Effect.succeed(unlicensedRefusalOf(file, detail)),
      ),
    );
    if ('busy' in checked) {
      return busy;
    }
    if ('refused' in checked) {
      return yield* recordedRefusal(ports, build, checked);
    }
    const taken = yield* recordedUpload(ports, build, checked);
    yield* (taken ? staged : stagedUnlessItIs)(ports, build, file.path, file.sha256);
    const uploaded: FittedUpload = { sha256: file.sha256 };
    return uploaded;
  }).pipe(Effect.catchTags({ invalid_input: refusedUpload, conflict: refusedUpload }));
}
