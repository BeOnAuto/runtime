import { CallLineage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { claimOf, type Claim } from '../runs/run-claims.ts';
import { attemptIsLive, stillRunning } from '../runs/run-decisions.ts';
import { runAnswered, noRunCalled } from '../runs/run-lookup.ts';
import {
  endedAsRefused,
  endedForItsLostDocument,
  inputToRunOf,
  interruptedByItsCancel,
  nextAttemptWith,
  type AttemptRefusal,
  type AttemptToEnd,
  type AttemptWithoutItsInput,
  type NextAttempt,
} from './attempt-inputs.ts';
import { versionToResume, type VersionToResume, type VersionToRun } from './definition-preparation.ts';
import { claimedAttempt, loadAttempt, loadStartedRun } from './run-access.ts';
import { contextOf, type Called, type Prepared } from './run-contexts.ts';

export type Resumed = Extract<Claim, { readonly type: 'resume' }>['run'];

interface AttemptBefore {
  readonly given: Called;
  readonly read: Readonly<Effect.Success<ReturnType<typeof loadAttempt>>>;
  readonly correlationId: string;
}

interface DeadAttempt extends AttemptBefore {
  readonly version: VersionToResume;
  readonly cancelAsked: boolean;
}

const attemptBeforeOf = Effect.fnUntraced(function* (capabilities: readonly Capability[], id: string) {
  const given: Called = { ...(yield* CallLineage), capabilities };
  const read = yield* loadAttempt(id);
  const before: AttemptBefore = { given, read, correlationId: given.lineage?.correlationId ?? id };
  return before;
});

function isLive(version: VersionToResume, quietMs: number): boolean {
  return 'toRun' in version && attemptIsLive(quietMs, version.toRun.prepared.resumesAfterMs);
}

function definitionOf(version: VersionToResume): VersionToRun {
  return 'toRun' in version ? version.toRun.definition : version.definition;
}

const deadAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const version = yield* versionToResume(capability, run.run.name, run.run.definition_version);
  const before = yield* attemptBeforeOf(capabilities, id);
  const cancelAsked = run.cancel !== undefined;
  if (!cancelAsked && !before.given.attemptDied && isLive(version, before.read.quietMs)) {
    return yield* stillRunning;
  }
  const dead: DeadAttempt = { ...before, version, cancelAsked };
  return dead;
});

function endingAfter(
  id: string,
  run: Resumed,
  { given, read, correlationId }: AttemptBefore,
  definition: VersionToRun,
) {
  const lineage = { startId: read.lastMessageId, correlationId };
  return Effect.map(
    contextOf(id, { definition }, given, { lineage, attempt: read.attempt }),
    (context): AttemptToEnd => ({ id, context, number: run.attempt }),
  );
}

function endingAfterTheDead(id: string, run: Resumed, dead: DeadAttempt) {
  return endingAfter(id, run, dead, definitionOf(dead.version));
}

function endingOf(toEnd: AttemptToEnd, { version, cancelAsked }: DeadAttempt) {
  return 'lost' in version && !cancelAsked
    ? Effect.uninterruptible(endedForItsLostDocument(toEnd, version.lost))
    : interruptedByItsCancel(toEnd);
}

function answeredNext(answer: Effect.Success<ReturnType<typeof endingOf>>): NextAttempt {
  return { type: 'answered', answer };
}

const afterTheDeadWithItsInput = Effect.fnUntraced(function* (
  id: string,
  run: Resumed,
  dead: DeadAttempt,
  toRun: Prepared,
) {
  const input = yield* inputToRunOf(run);
  const toEnd = yield* endingAfterTheDead(id, run, dead);
  return yield* nextAttemptWith({ ...toEnd, run: toRun }, input);
});

export const resumedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const dead = yield* deadAttemptOf(capabilities, capability, id, run);
  const { version } = dead;
  return 'toRun' in version && !dead.cancelAsked
    ? yield* afterTheDeadWithItsInput(id, run, dead, version.toRun)
    : answeredNext(yield* Effect.uninterruptible(endingOf(yield* endingAfterTheDead(id, run, dead), dead)));
});

const claimedAfter = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt, toRun: Prepared) {
  const { given, read, correlationId } = dead;
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

const claimedWithItsInput = Effect.fnUntraced(function* (id: string, run: Resumed, dead: DeadAttempt, toRun: Prepared) {
  const input = yield* inputToRunOf(run);
  return yield* nextAttemptWith(yield* claimedAfter(id, run, dead, toRun), input);
});

const claimedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resumed,
) {
  const dead = yield* deadAttemptOf(capabilities, capability, id, run);
  const { version } = dead;
  return 'toRun' in version && !dead.cancelAsked
    ? yield* claimedWithItsInput(id, run, dead, version.toRun)
    : answeredNext(yield* endingOf(yield* endingAfterTheDead(id, run, dead), dead));
});

const claimToResume = Effect.fnUntraced(function* (capability: Capability, id: string) {
  const { recorded, run } = yield* loadStartedRun(id);
  if (run === undefined) {
    return yield* Effect.fail(noRunCalled(id));
  }
  const asked = { definition_type: capability.type, name: run.run.name, input: run.input };
  const claim = yield* Effect.fromResult(claimOf(recorded, asked, capability.resumes));
  return { claim, recorded };
});

export const nextAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
) {
  const { claim, recorded } = yield* claimToResume(capability, id);
  if (claim.type !== 'resume') {
    const answered: NextAttempt = { type: 'answered', answer: yield* runAnswered(id, recorded) };
    return answered;
  }
  return yield* claimedAttemptOf(capabilities, capability, id, claim.run);
});

const refusedAfterTheDead = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  id: string,
  run: Resumed,
  refusal: AttemptRefusal,
) {
  const before = yield* attemptBeforeOf(capabilities, id);
  const cancelAsked = run.cancel !== undefined;
  if (!cancelAsked && !before.given.attemptDied) {
    return yield* stillRunning;
  }
  const toEnd = yield* endingAfter(id, run, before, { name: run.run.name, version: run.run.definition_version });
  return yield* Effect.uninterruptible(cancelAsked ? interruptedByItsCancel(toEnd) : endedAsRefused(toEnd, refusal));
});

export const nextAttemptRefused = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  refusal: AttemptRefusal,
) {
  const { claim, recorded } = yield* claimToResume(capability, id);
  if (claim.type !== 'resume') {
    return yield* runAnswered(id, recorded);
  }
  return yield* refusedAfterTheDead(capabilities, id, claim.run, refusal);
});
