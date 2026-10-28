import { Effect, Option } from 'effect';

import { aMinute, recordedWork, restingUntil, type Performing } from '../build-work/build-performing.ts';
import { executingRuntimeOf } from '../runtimes/model-runtimes.ts';
import { walkedCandidate } from './candidate-walk.ts';
import type { ScoredBuild } from './scoring-inputs.ts';

export function scoredCandidate(performing: Performing, scored: ScoredBuild, sha256: string): Effect.Effect<void> {
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
    const path = yield* ports.caches.models.pathOf(executing.file, () =>
      ports.ledger.content.staged({ org, playbook }, id, sha256),
    );
    return path === undefined
      ? yield* notLoaded(`Candidate ${sha256.slice(0, 12)}… is no longer staged under its build`)
      : yield* walkedCandidate(performing, scored, { executing, file: { sha256, path } });
  }).pipe(Effect.ensuring(Effect.sync(release)));
}
