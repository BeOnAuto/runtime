import { Data, Effect, Option } from 'effect';

import {
  aMinute,
  recordedWork,
  restingUntil,
  type Performing,
  type PerformedStep,
} from '../build-work/build-performing.ts';
import { executingRuntimeOf } from '../runtimes/model-runtimes.ts';
import { walkedCandidate } from './candidate-walk.ts';
import type { ScoredBuild } from './scoring-inputs.ts';

class NotStaged extends Data.TaggedError('not_staged') {}

export function scoredCandidate(performing: Performing, scored: ScoredBuild, sha256: string): PerformedStep {
  const { ports, build, now } = performing;
  const release = ports.permits.take();
  if (release === null) {
    return restingUntil(performing, now + aMinute);
  }
  const { org, playbook, id } = build.address;
  const notLoaded = (detail: string) =>
    recordedWork(performing, { type: 'candidate_disqualified', data: { sha256, because: 'not_loaded', detail } });
  const uploaded = Option.getOrThrow(Option.fromNullishOr(build.uploads.find((each) => each.sha256 === sha256)));
  const executing = executingRuntimeOf(ports.runtimes, uploaded);
  return Effect.gen(function* () {
    if (executing === undefined) {
      return yield* notLoaded(
        `No model runtime this server has installed executes the format ${uploaded.format} of the candidate`,
      );
    }
    const staged = () => ports.ledger.content.staged({ org, playbook }, id, sha256);
    const placed = Effect.flatMap(ports.caches.models.pathOf(executing.file, staged), (path) =>
      path === undefined ? Effect.fail(new NotStaged()) : Effect.succeed({ sha256, path }),
    );
    return yield* walkedCandidate(performing, scored, { executing, sha256, placed, format: uploaded.format }).pipe(
      Effect.catchTag('not_staged', () =>
        notLoaded(`Candidate ${sha256.slice(0, 12)}… is no longer staged under its build`),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(release)));
}
