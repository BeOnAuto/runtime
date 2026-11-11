import { runEndingOf, type RunEnding } from '@on.auto/definitions';
import { streamPrefixOfPlaybook, type PlaybookAddress, type CalledBy, type Conflict } from '@on.auto/operations';
import {
  callKeyText,
  type CallAnsweredResult,
  type CallKey,
  type ContentUnavailable,
  type RunInput,
  type Submission,
} from '@on.auto/workflow-engine';
import { Effect, type Cause } from 'effect';

import { answeredRow, callRowOf, deliveredRow, waitingCallsOf } from '../calls/call-rows.ts';
import { undeliveredAnswersOf } from '../calls/undelivered-answers.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { callConsumerOf, DeliveryFailed, type CallConsumer, type CallRecord } from '../follower/consumers.ts';
import { addressOfRun, runKeyOf } from '../runs/run-address.ts';
import type { WaitingOptions } from './waiting-options.ts';

export interface EndingParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict | ContentUnavailable>;
  readonly resultOf: WaitingOptions['resultOf'];
  readonly now: () => number;
  readonly trouble: (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}

interface CalledEnding {
  readonly ending: RunEnding;
  readonly calledBy: CalledBy;
}

interface Ended {
  readonly playbook: PlaybookAddress;
  readonly ending: RunEnding;
}

function calledEndingOf(ending: RunEnding | undefined): CalledEnding | undefined {
  const calledBy = ending?.context.calledBy;
  return ending === undefined || calledBy === undefined ? undefined : { ending, calledBy };
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

type Deliver = (key: CallKey, result: CallAnsweredResult) => Effect.Effect<void, DeliveryFailed>;

function strictly(parts: EndingParts): Deliver {
  return (key, result) =>
    parts
      .submitted({ kind: 'call_answered', runId: key.runId, at: parts.now(), key, result })
      .pipe(Effect.andThen(deliveredRow(parts.database, callKeyText(key))), Effect.mapError(failedWith));
}

function laterIfItFails(parts: EndingParts): Deliver {
  const deliver = strictly(parts);
  return (key, result) =>
    deliver(key, result).pipe(
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        parts.trouble(
          "An answer of a call was kept but could not be given to its run; the host gives it again at a sweep and before the run's next timer",
          cause,
        ),
      ),
    );
}

function answeredWith(
  { parts, deliver }: Answering,
  playbook: PlaybookAddress,
  calledBy: CalledBy,
  result: CallAnsweredResult,
): Effect.Effect<boolean, DeliveryFailed> {
  const runId = runKeyOf({ ...playbook, runId: calledBy.runId });
  const key = { runId, reference: calledBy.reference, run: calledBy.run };
  const answered = answeredRow(parts.database, callKeyText(key), result).pipe(
    Effect.mapError(failedWith),
    Effect.andThen(deliver(key, result)),
  );
  return callRowOf(parts.database, callKeyText(key)).pipe(
    Effect.mapError(failedWith),
    Effect.flatMap((row) => (row?.state === 'waiting' ? Effect.as(answered, true) : Effect.succeed(false))),
  );
}

interface Answering {
  readonly parts: EndingParts;
  readonly deliver: Deliver;
}

function answeredByItsEnding(answering: Answering, playbook: PlaybookAddress, { ending, calledBy }: CalledEnding) {
  return answeredWith(answering, playbook, calledBy, answering.parts.resultOf(ending));
}

export type WaitingCallAnswered = (
  playbook: PlaybookAddress,
  calledBy: CalledBy,
  result: CallAnsweredResult,
) => Effect.Effect<boolean, DeliveryFailed>;

export function waitingCallAnsweredOn(parts: EndingParts): WaitingCallAnswered {
  const answering = { parts, deliver: laterIfItFails(parts) };
  return (playbook, calledBy, result) => answeredWith(answering, playbook, calledBy, result);
}

export function childStreamOf(playbook: PlaybookAddress, child: string): string {
  return `${streamPrefixOfPlaybook(playbook)}runs/${child}`;
}

function childEndingOf(database: HostDatabase, playbook: PlaybookAddress, child: string) {
  return Effect.map(
    Effect.promise(() => database.store.lastMessageOf(childStreamOf(playbook, child))),
    (last) => calledEndingOf(runEndingOf(last)),
  );
}

export function childAnswersOn(
  database: HostDatabase,
  resultOf: WaitingOptions['resultOf'],
): (runKey: string, child: string) => Effect.Effect<CallAnsweredResult | undefined> {
  return (runKey, child) => {
    const { org, playbook } = addressOfRun(runKey);
    return Effect.map(childEndingOf(database, { org, playbook }, child), (called) =>
      called === undefined ? undefined : resultOf(called.ending),
    );
  };
}

function endedOf({ playbook, record }: CallRecord): Ended | undefined {
  const ending = runEndingOf(record);
  return ending === undefined ? undefined : { playbook, ending };
}

export function childEndings(parts: EndingParts): CallConsumer {
  const answering = { parts, deliver: laterIfItFails(parts) };
  return callConsumerOf({
    name: 'child_endings',
    types: ['run_succeeded', 'run_rejected', 'run_failed'],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    readOf: endedOf,
    batchOf: ({ playbook, ending }, after) =>
      Effect.sync(() => {
        const called = after === undefined ? calledEndingOf(ending) : undefined;
        return {
          deliveries:
            called === undefined
              ? []
              : [
                  {
                    key: 'call',
                    workflow: called.calledBy.runId,
                    deliver: Effect.asVoid(answeredByItsEnding(answering, playbook, called)),
                    skipped: () => Effect.void,
                  },
                ],
          through: undefined,
          more: false,
        };
      }),
  });
}

export function endedChildrenOn(parts: EndingParts): (runKey: string) => Effect.Effect<void, DeliveryFailed> {
  const { database } = parts;
  const answering = { parts, deliver: strictly(parts) };
  return (runKey) =>
    Effect.gen(function* () {
      const { org, playbook } = addressOfRun(runKey);
      for (const { call, result } of yield* Effect.mapError(undeliveredAnswersOf(database, runKey), failedWith)) {
        yield* answering.deliver(call.key, result);
      }
      const waiting = yield* Effect.mapError(waitingCallsOf(database, runKey), failedWith);
      for (const { child } of waiting) {
        const called = yield* childEndingOf(database, { org, playbook }, child);
        if (called !== undefined) {
          yield* answeredByItsEnding(answering, { org, playbook }, called);
        }
      }
    });
}
