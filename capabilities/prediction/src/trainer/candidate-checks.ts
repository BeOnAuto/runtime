import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { BuildWorkOf } from '../facts/build-facts.ts';
import { modelFileName, type CachedFile } from '../model-cache/model-files.ts';
import type { ModelOutcome, Signature } from '../model-processes/model-processes.ts';
import { fedShapeOf, runtimeNamed, type ExecutedFormat } from '../runtimes/model-runtimes.ts';

type Uploaded = BuildWorkOf<'candidate_uploaded'>['data'];

type Refusal = Omit<BuildWorkOf<'candidate_refused'>['data'], 'sha256' | 'bytes'>;

export type Checked =
  | { readonly uploaded: Uploaded; readonly already: boolean }
  | { readonly refused: BuildWorkOf<'candidate_refused'>['data'] }
  | { readonly busy: true };

export interface Checking {
  readonly build: BuildState;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly chosen: ExecutedFormat;
}

const { candidatesInABuild } = predictionBounds;

const loadingWords: Readonly<Record<'timed_out' | 'out_of_memory', string>> = {
  timed_out: 'The file could not be loaded within the 30 s a check takes',
  out_of_memory: 'The file needed more memory to load than a model process has',
};

function refusalOf(outcome: Exclude<ModelOutcome<Signature>, { readonly ended: 'answered' }>): Refusal | undefined {
  if (outcome.ended === 'timed_out' || outcome.ended === 'out_of_memory') {
    return { because: 'failed_to_load', detail: loadingWords[outcome.ended] };
  }
  return outcome.ended === 'crashed' || outcome.ended === 'badly'
    ? { because: 'failed_to_load', detail: `The model process ended while it loaded the file: ${outcome.detail}` }
    : undefined;
}

function answeredOf({ chosen }: Checking, file: CachedFile, signature: Signature): Checked {
  const { sha256, bytes } = file;
  if (!signature.loaded) {
    const detail = `The file is not a model the runtime loads: ${signature.detail}`;
    return { refused: { sha256, bytes, because: 'failed_to_load', detail } };
  }
  if (signature.issue !== null) {
    return { refused: { sha256, bytes, because: 'wrong_signature', detail: signature.issue } };
  }
  const runtime = runtimeNamed(chosen.runtime);
  return {
    uploaded: { sha256, bytes, format: chosen.format, runtime, signature: signature.signature },
    already: false,
  };
}

export function receivedCandidate(
  ports: PredictionPorts,
  { chosen }: Checking,
  stream: ReadableStream<Uint8Array>,
): Effect.Effect<CachedFile> {
  return ports.caches.models.received(stream, modelFileName(chosen.format));
}

export function checkedCandidate(ports: PredictionPorts, checking: Checking, file: CachedFile): Effect.Effect<Checked> {
  const { build, document, chosen } = checking;
  const { sha256, bytes } = file;
  const already = build.uploads.find((uploaded) => uploaded.sha256 === sha256);
  if (already !== undefined) {
    return Effect.succeed({ uploaded: already, already: true });
  }
  if (build.uploads.length >= candidatesInABuild) {
    const detail = `The build has its ${candidatesInABuild} candidates`;
    return Effect.succeed({ refused: { sha256, bytes, because: 'too_many', detail } });
  }
  const checked = ports.models.check(chosen.runtime, { sha256, path: file.path }, fedShapeOf(document));
  return Effect.map(checked, (outcome): Checked => {
    if (outcome.ended === 'answered') {
      return answeredOf(checking, file, outcome.answer);
    }
    const refusal = refusalOf(outcome);
    return refusal === undefined ? { busy: true } : { refused: { sha256, bytes, ...refusal } };
  });
}
