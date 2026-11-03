import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { isTaken, takesAStartOnce } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { pausedRefusalOf, preparedVersion } from './definition-preparation.ts';
import { runPrepared } from './prepared-run.ts';
import { loadRun, loadStartedRun } from './run-access.ts';

const answeredWhilePaused = Effect.fnUntraced(function* (id: string, request: RunRequest) {
  const { recorded, run } = yield* loadStartedRun(id);
  return takesAStartOnce(run, request) ? yield* answerOf(id, recorded) : undefined;
});

export const startVersionOnce = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest & { readonly version: number },
  id: string,
) {
  const { version, ...asked } = request;
  const run = yield* preparedVersion(capability, asked.name, version);
  const paused = yield* pausedRefusalOf(capability.type, asked.name);
  if (paused !== undefined) {
    const answered = yield* answeredWhilePaused(id, asked);
    return answered ?? (yield* paused);
  }
  return yield* runPrepared(capabilities, id, asked, { ...run, createOnly: true }).pipe(
    Effect.catchIf(isTaken, () => Effect.flatMap(loadRun(id), (recorded) => answerOf(id, recorded))),
  );
});
