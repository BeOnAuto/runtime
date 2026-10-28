import { contentOfBytes } from '@on.auto/operations';
import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { FittedAnswer } from '../model-processes/model-processes.ts';
import { fedShapeOf, formatsAcceptedFor } from '../runtimes/model-runtimes.ts';
import { checkedCandidate, receivedCandidate } from './candidate-checks.ts';
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

export function uploadedFitted(
  { ports, build, document }: FittedUploading,
  { format, bytes }: FittedAnswer,
): Effect.Effect<FittedUpload> {
  const chosen = formatsAcceptedFor(ports.runtimes, fedShapeOf(document)).find((each) => each.format === format);
  if (chosen === undefined) {
    return Effect.succeed(refused);
  }
  const checking = { build, document, chosen };
  return Effect.gen(function* () {
    const file = yield* receivedCandidate(ports, checking, contentOfBytes(bytes, 'application/octet-stream').stream);
    const checked = yield* checkedCandidate(ports, checking, file);
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
  }).pipe(Effect.catch(() => Effect.succeed(refused)));
}
