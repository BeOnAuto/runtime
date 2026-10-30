import { lastEndingOf, runEndingOf, type RunEnding } from '@on.auto/definitions';
import {
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type CalledBy,
  type CallResult,
  type Conflict,
} from '@on.auto/operations';
import { callKeyText, type RunInput, type Submission } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { answeredRow, callRowOf, deliveredRow, waitingCallsOf } from '../calls/call-rows.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { callConsumerOf, DeliveryFailed, type CallConsumer, type CallRecord } from '../follower/consumers.ts';
import { addressOfRun, runKeyOf } from '../runs/run-address.ts';
import type { WaitingOptions } from './waiting-options.ts';

export interface EndingParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly resultOf: WaitingOptions['resultOf'];
  readonly now: () => number;
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

function answeredWith(parts: EndingParts, playbook: PlaybookAddress, { ending, calledBy }: CalledEnding) {
  const runId = runKeyOf({ ...playbook, runId: calledBy.runId });
  const key = { runId, reference: calledBy.reference, run: calledBy.run };
  const result = parts.resultOf(ending);
  const answered = parts
    .submitted({ kind: 'call_answered', runId, at: parts.now(), key, result })
    .pipe(
      Effect.andThen(answeredRow(parts.database, callKeyText(key), result)),
      Effect.andThen(deliveredRow(parts.database, callKeyText(key))),
    );
  return callRowOf(parts.database, callKeyText(key)).pipe(
    Effect.flatMap((row) => (row?.state === 'waiting' ? answered : Effect.void)),
    Effect.mapError(failedWith),
  );
}

export function childStreamOf(playbook: PlaybookAddress, child: string): string {
  return `${streamPrefixOfPlaybook(playbook)}runs/${child}`;
}

function childEndingOf(database: HostDatabase, playbook: PlaybookAddress, child: string) {
  return Effect.map(
    Effect.promise(() => database.store.read(childStreamOf(playbook, child), 0)),
    ({ messages }) => calledEndingOf(lastEndingOf(messages)),
  );
}

export function childAnswersOn(
  database: HostDatabase,
  resultOf: WaitingOptions['resultOf'],
): (runKey: string, child: string) => Effect.Effect<CallResult | undefined> {
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
                    deliver: answeredWith(parts, playbook, called),
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
  return (runKey) =>
    Effect.gen(function* () {
      const { org, playbook } = addressOfRun(runKey);
      const waiting = yield* Effect.mapError(waitingCallsOf(database, runKey), failedWith);
      for (const { child } of waiting) {
        const called = yield* childEndingOf(database, { org, playbook }, child);
        if (called !== undefined) {
          yield* answeredWith(parts, { org, playbook }, called);
        }
      }
    });
}
