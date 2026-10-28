import { defineHttpOperation, Unavailable, type StreamedContent } from '@on.auto/operations';
import { Effect } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { checkedCandidate, receivedCandidate, type Checking } from './candidate-checks.ts';
import { checkingOf } from './candidate-formats.ts';
import { recordedRefusal, recordedUpload } from './candidate-records.ts';
import { staged, stagedUnlessItIs } from './candidate-staging.ts';
import { UploadedSchema, UploadInput } from './upload-schemas.ts';
import { waitingBuildOf } from './waiting-builds.ts';

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

function uploadedTo(ports: PredictionPorts, checking: Checking, body: StreamedContent) {
  const { build } = checking;
  return Effect.gen(function* () {
    const file = yield* receivedCandidate(ports, checking, body.stream);
    const checked = yield* checkedCandidate(ports, checking, file);
    if ('busy' in checked) {
      return yield* Effect.fail(busy);
    }
    if ('refused' in checked) {
      return yield* recordedRefusal(ports, build, checked);
    }
    const taken = yield* recordedUpload(ports, build, checked);
    yield* (taken ? staged : stagedUnlessItIs)(ports, build, file.path, file.sha256);
    const { sha256, bytes, format, signature } = checked.uploaded;
    return { candidate: sha256, bytes, format, signature };
  });
}

function unread(body: StreamedContent): Effect.Effect<void> {
  return Effect.promise(() => body.stream.cancel());
}

export function uploadCandidate(ports: PredictionPorts) {
  return defineHttpOperation('playbook', 'command', {
    name: 'upload_candidate',
    title: 'Upload candidate',
    description: [
      'Uploads a candidate model to a build of a prediction function that waits for its trainer: a file in a format the brief of the build lists, named by format, at most 64 MiB, with its Content-Length.',
      'The file is checked in a model process by the model runtime of its format, and refused when that runtime does not load it, when its signature is not the one the function feeds, or when the build has its 8 candidates; a format the server does not execute for the function is refused at format.',
      'The answer is the SHA-256 the answer to the build names; the same bytes again answer the same.',
    ].join(' '),
    route: { method: 'POST', path: '/runs/{run_id}/build/candidates' },
    body: { kind: 'octet-stream', mostBytes: predictionBounds.mostCandidateBytes },
    inputSchema: UploadInput,
    answer: { kind: 'json', outputSchema: UploadedSchema },
    reasons: ['invalid_input', 'not_found', 'conflict', 'unavailable'],
    handle: ({ run_id: id, format }, body: StreamedContent) =>
      Effect.gen(function* () {
        const { build } = yield* waitingBuildOf(id);
        const checking = yield* checkingOf(ports, build, format).pipe(Effect.tapError(() => unread(body)));
        const release = ports.permits.take();
        if (release === null) {
          yield* unread(body);
          return yield* Effect.fail(busy);
        }
        return yield* uploadedTo(ports, checking, body).pipe(Effect.ensuring(Effect.sync(release)));
      }),
  });
}
