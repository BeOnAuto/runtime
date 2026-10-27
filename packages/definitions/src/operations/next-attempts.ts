import { CallLineage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { attemptIsLive, claimOf, stillRunning, type Claim } from '../runs/run-decisions.ts';
import { answerOf, noRunCalled } from '../runs/run-lookup.ts';
import type { RunDetail } from '../runs/run.ts';
import { answeredWith, type AttemptOfARun } from './attempt-endings.ts';
import { preparedVersion } from './definition-preparation.ts';
import { claimedAttempt, loadAttempt, loadStartedRun } from './run-access.ts';
import { contextOf, type Called, type Prepared } from './run-contexts.ts';

export type Resumed = Extract<Claim, { readonly type: 'resume' }>['run'];

interface ResumedAttempt extends AttemptOfARun {
  readonly cancelAsked: boolean;
}

export type NextAttempt =
  | { readonly type: 'answered'; readonly answer: RunDetail }
  | { readonly type: 'attempt'; readonly attempt: AttemptOfARun };

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
  return Effect.map(contextOf(id, toRun, given, { lineage, attempt: read.attempt }), (context): AttemptOfARun => ({
    id,
    run: toRun,
    input: run.input,
    context,
    number: run.attempt,
  }));
}

export const resumedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const dead = yield* deadAttemptOf(capabilities, capability, id, run);
  const resumed: ResumedAttempt = { ...(yield* attemptAfterTheDead(id, run, dead)), cancelAsked: dead.cancelAsked };
  return resumed;
});

export function interruptedByItsCancel({ id, context, number }: AttemptOfARun) {
  return answeredWith(id, context, { type: 'run_interrupted' }, number);
}

const claimedAfter = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt) {
  const { toRun, given, read, correlationId } = dead;
  const number = run.attempt + 1;
  const startId = yield* claimedAttempt(
    id,
    { readAt: read.readAt, attempt: number },
    { causationId: read.lastMessageId, correlationId },
  );
  const context = yield* contextOf(id, toRun, given, { lineage: { startId, correlationId }, attempt: read.attempt });
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
  if (claim.type !== 'resume') {
    const answered: NextAttempt = { type: 'answered', answer: yield* answerOf(id, recorded) };
    return answered;
  }
  return yield* claimedAttemptOf(capabilities, capability, id, claim.run);
});
