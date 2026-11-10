import { CallLineage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { claimOf, type Claim } from '../runs/run-claims.ts';
import { attemptIsLive, stillRunning } from '../runs/run-decisions.ts';
import { runAnswered, noRunCalled } from '../runs/run-lookup.ts';
import {
  inputToRunOf,
  interruptedByItsCancel,
  nextAttemptWith,
  type AttemptWithoutItsInput,
  type NextAttempt,
} from './attempt-inputs.ts';
import { preparedVersion } from './definition-preparation.ts';
import { claimedAttempt, loadAttempt, loadStartedRun } from './run-access.ts';
import { contextOf, type Called, type Prepared } from './run-contexts.ts';

export type Resumed = Extract<Claim, { readonly type: 'resume' }>['run'];

interface DeadAttempt {
  readonly toRun: Prepared;
  readonly given: Called;
  readonly read: Readonly<Effect.Success<ReturnType<typeof loadAttempt>>>;
  readonly cancelAsked: boolean;
  readonly correlationId: string;
}

const deadAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const toRun = yield* preparedVersion(capability, run.run.name, run.run.definition_version);
  const given: Called = { ...(yield* CallLineage), capabilities };
  const read = yield* loadAttempt(id);
  const cancelAsked = run.cancel !== undefined;
  if (!cancelAsked && !given.attemptDied && attemptIsLive(read.quietMs, toRun.prepared.resumesAfterMs)) {
    return yield* stillRunning;
  }
  const dead: DeadAttempt = { toRun, given, read, cancelAsked, correlationId: given.lineage?.correlationId ?? id };
  return dead;
});

function attemptAfterTheDead(id: string, run: Resumed, dead: DeadAttempt) {
  const { toRun, given, read, correlationId } = dead;
  const lineage = { startId: read.lastMessageId, correlationId };
  return Effect.map(
    contextOf(id, toRun, given, { lineage, attempt: read.attempt }),
    (context): AttemptWithoutItsInput => ({ id, run: toRun, context, number: run.attempt }),
  );
}

const afterTheDeadWithItsInput = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt) {
  const input = yield* inputToRunOf(run);
  return yield* nextAttemptWith(yield* attemptAfterTheDead(id, run, dead), input);
});

export const resumedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const dead = yield* deadAttemptOf(capabilities, capability, id, run);
  const next: NextAttempt = dead.cancelAsked
    ? {
        type: 'answered',
        answer: yield* Effect.uninterruptible(interruptedByItsCancel(yield* attemptAfterTheDead(id, run, dead))),
      }
    : yield* afterTheDeadWithItsInput(id, run, dead);
  return next;
});

const claimedAfter = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt) {
  const { toRun, given, read, correlationId } = dead;
  const number = run.attempt + 1;
  const startId = yield* claimedAttempt(
    id,
    { readAt: read.readAt, attempt: number },
    { causationId: read.lastMessageId, correlationId },
  );
  const context = yield* contextOf(id, toRun, given, { lineage: { startId, correlationId }, attempt: read.attempt });
  const claimed: AttemptWithoutItsInput = { id, run: toRun, context, number };
  return claimed;
});

const claimedWithItsInput = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt) {
  const input = yield* inputToRunOf(run);
  return yield* nextAttemptWith(yield* claimedAfter(id, run, dead), input);
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
    : yield* claimedWithItsInput(id, run, dead);
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
  const asked = { definition_type: capability.type, name: run.run.name, input: run.input };
  const claim = yield* Effect.fromResult(claimOf(recorded, asked, capability.resumes));
  if (claim.type !== 'resume') {
    const answered: NextAttempt = { type: 'answered', answer: yield* runAnswered(id, recorded) };
    return answered;
  }
  return yield* claimedAttemptOf(capabilities, capability, id, claim.run);
});
