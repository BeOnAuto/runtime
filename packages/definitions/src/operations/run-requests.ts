import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { claimOf } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { answeredAttempt } from './attempt-endings.ts';
import { preparedDefinition } from './definition-preparation.ts';
import { interruptedByItsCancel, resumedAttemptOf, type Resumed } from './next-attempts.ts';
import { runPrepared } from './prepared-run.ts';
import { loadRunStream } from './run-access.ts';

const resumedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  state: Resumed,
) {
  const resumed = yield* resumedAttemptOf(capabilities, capability, id, state);
  return yield* Effect.uninterruptibleMask((restore) =>
    resumed.cancelAsked ? interruptedByItsCancel(resumed) : answeredAttempt(resumed, restore),
  );
});

export const requestedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest,
  id: string,
) {
  const recorded = yield* loadRunStream(id);
  const claim = yield* Effect.fromResult(claimOf(recorded, request, capability.resumes));
  if (claim.type === 'answer') {
    return yield* answerOf(id, recorded);
  }
  return claim.type === 'resume'
    ? yield* resumedRun(capabilities, capability, id, claim.run)
    : yield* runPrepared(capabilities, id, request, yield* preparedDefinition(capability, request.name));
});
