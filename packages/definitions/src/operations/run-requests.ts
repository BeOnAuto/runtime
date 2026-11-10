import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { claimOf, comparedWithItsRecordedInput } from '../runs/run-claims.ts';
import { askedOf, type RunRequest } from '../runs/run-commands.ts';
import { runAnswered } from '../runs/run-lookup.ts';
import { answeredAttempt } from './attempt-endings.ts';
import { preparedDefinition } from './definition-preparation.ts';
import { resumedAttemptOf, type Resumed } from './next-attempts.ts';
import { runPrepared } from './prepared-run.ts';
import { loadRunStream } from './run-access.ts';

const resumedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  state: Resumed,
) {
  const resumed = yield* resumedAttemptOf(capabilities, capability, id, state);
  return resumed.type === 'answered'
    ? resumed.answer
    : yield* Effect.uninterruptibleMask((restore) => answeredAttempt(resumed.attempt, restore));
});

export const requestedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  given: RunRequest,
  id: string,
) {
  const recorded = yield* loadRunStream(id);
  const request = yield* comparedWithItsRecordedInput(recorded, given);
  const claim = yield* Effect.fromResult(claimOf(recorded, askedOf(request), capability.resumes));
  if (claim.type === 'answer') {
    return yield* runAnswered(id, recorded);
  }
  return claim.type === 'resume'
    ? yield* resumedRun(capabilities, capability, id, claim.run)
    : yield* runPrepared(capabilities, id, request, yield* preparedDefinition(capability, request.name));
});
