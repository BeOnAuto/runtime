import { CallLineage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { answeredWith, type AttemptOfARun } from '../operations/attempt-endings.ts';
import { preparedVersion } from '../operations/definition-preparation.ts';
import { loadAttempt } from '../operations/run-access.ts';
import { contextOf, type Called, type Prepared } from '../operations/run-contexts.ts';
import { attemptIsLive, stillRunning, type Claim } from '../runs/run-decisions.ts';

export type Resumed = Extract<Claim, { readonly type: 'resume' }>['run'];

interface ResumedAttempt extends AttemptOfARun {
  readonly cancelAsked: boolean;
}

export interface DeadAttempt {
  readonly toRun: Prepared;
  readonly given: Called;
  readonly read: Readonly<Effect.Success<ReturnType<typeof loadAttempt>>>;
  readonly cancelAsked: boolean;
  readonly correlationId: string;
}

export const deadAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const toRun = yield* preparedVersion(capability, run.run.name, run.run.definition_version);
  const given: Called = { ...(yield* CallLineage), capabilities };
  const read = yield* loadAttempt(id);
  const cancelAsked = run.cancel !== undefined;
  const diedOrWaits = given.attemptDied || run.deferred;
  if (!cancelAsked && !diedOrWaits && attemptIsLive(read.quietMs, toRun.prepared.resumesAfterMs)) {
    return yield* stillRunning;
  }
  const dead: DeadAttempt = { toRun, given, read, cancelAsked, correlationId: given.lineage?.correlationId ?? id };
  return dead;
});

export function attemptAfterTheDead(id: string, run: Resumed, dead: DeadAttempt) {
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
