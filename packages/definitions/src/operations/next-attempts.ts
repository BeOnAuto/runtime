import { Clock, Effect } from 'effect';

import {
  attemptAfterTheDead,
  deadAttemptOf,
  interruptedByItsCancel,
  type DeadAttempt,
  type Resumed,
} from '../attempts/resumed-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import { claimOf } from '../runs/run-decisions.ts';
import { answerOf, noRunCalled } from '../runs/run-lookup.ts';
import { goesOnAfterItsRequest } from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';
import type { AttemptOfARun } from './attempt-endings.ts';
import { claimedAttempt, loadCalls, loadStartedRun } from './run-access.ts';
import { contextOf } from './run-contexts.ts';

export type NextAttempt =
  | { readonly type: 'answered'; readonly answer: RunDetail }
  | { readonly type: 'attempt'; readonly attempt: AttemptOfARun };

const claimedAfter = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt) {
  const { toRun, given, read, correlationId } = dead;
  const number = run.attempt + 1;
  const startId = yield* claimedAttempt(
    id,
    { readAt: read.readAt, attempt: number },
    { causationId: read.lastMessageId, correlationId },
  );
  const attempt = run.deferred ? yield* loadCalls(id) : read.attempt;
  const context = yield* contextOf(id, toRun, given, { lineage: { startId, correlationId }, attempt });
  const claimed: AttemptOfARun = { id, run: toRun, input: run.input, context, number };
  return claimed;
});

const claimedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const dead = yield* deadAttemptOf(capabilities, capability, id, run);
  const next: NextAttempt = dead.cancelAsked
    ? { type: 'answered', answer: yield* interruptedByItsCancel(yield* attemptAfterTheDead(id, run, dead)) }
    : { type: 'attempt', attempt: yield* claimedAfter(id, run, dead) };
  return next;
});

export const nextAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
) {
  const { recorded, run } = yield* loadStartedRun(id);
  if (run === undefined) {
    return yield* Effect.fail(noRunCalled(id));
  }
  const request = { definition_type: capability.type, name: run.run.name, input: run.input };
  const claim = yield* Effect.fromResult(claimOf(recorded, request, capability.resumes));
  const goesOn = claim.type === 'resume' || goesOnAfterItsRequest(run, yield* Clock.currentTimeMillis);
  if (!goesOn) {
    const answered: NextAttempt = { type: 'answered', answer: yield* answerOf(id, recorded) };
    return answered;
  }
  return yield* claimedAttemptOf(capabilities, capability, id, run);
});
