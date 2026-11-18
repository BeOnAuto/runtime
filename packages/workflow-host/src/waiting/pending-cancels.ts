import { cancelRequestOf } from '@on.auto/definitions';
import { messageIdOf, type Conflict } from '@on.auto/operations';
import type { CancelOrder, ContentUnavailable, RunInput, Submission } from '@on.auto/workflow-engine';
import { Effect, type Cause } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { runKeyOf, type FiledRun } from '../runs/run-address.ts';
import { runStreamOfTheKey } from '../runs/run-places.ts';
import { clearedPendingRow, pendingCancelRowsAfter, type PendingCancelRow } from './pending-cancel-rows.ts';

interface PendingCancel {
  readonly cancel: CancelOrder;
  readonly cause: string;
}

function isCancelRequest(message: unknown): boolean {
  return cancelRequestOf(message) !== undefined;
}

function pendingCancelOf(database: HostDatabase, run: FiledRun): Effect.Effect<PendingCancel | undefined> {
  const stream = runStreamOfTheKey(runKeyOf(run));
  return Effect.map(
    Effect.promise(() => database.store.read(stream, 0)),
    ({ messages }): PendingCancel | undefined => {
      const started = messages.findLastIndex(({ type }) => type === 'run_started');
      const asked = messages.findIndex((message, index) => index > started && isCancelRequest(message));
      const request = cancelRequestOf(messages[asked]);
      return request === undefined
        ? undefined
        : {
            cancel: { by: request.context.by, kind: request.data.kind, reason: request.data.reason },
            cause: messageIdOf(stream, asked + 1),
          };
    },
  );
}

export interface PendingParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict | ContentUnavailable>;
  readonly now: () => number;
}

export function cancelledIfAsked(
  parts: PendingParts,
  run: FiledRun,
): Effect.Effect<void, Conflict | ContentUnavailable> {
  return Effect.flatMap(pendingCancelOf(parts.database, run), (pending) =>
    pending === undefined
      ? Effect.void
      : Effect.asVoid(parts.submitted({ kind: 'cancel_requested', runId: runKeyOf(run), at: parts.now(), ...pending })),
  );
}

type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

const pendingRowsInAPage = 100;

const cancelsGivenAtOnce = 4;

const finishTypes: ReadonlySet<string> = new Set(['run_succeeded', 'run_rejected', 'run_failed']);

function hasEnded(database: HostDatabase, runKey: string): Effect.Effect<boolean> {
  return Effect.map(
    Effect.promise(() => database.store.lastMessageOf(runStreamOfTheKey(runKey))),
    (newest) => newest !== undefined && finishTypes.has(newest.type),
  );
}

function givenToItsRun(parts: PendingParts, { runKey, cause, cancel }: PendingCancelRow) {
  return Effect.flatMap(
    parts.submitted({ kind: 'cancel_requested', runId: runKey, at: parts.now(), cause, cancel }),
    ({ outcome }) => (outcome === 'not_started' ? Effect.void : clearedPendingRow(parts.database, runKey)),
  );
}

function givenOrKept(parts: PendingParts, trouble: Trouble, row: PendingCancelRow) {
  return Effect.flatMap(hasEnded(parts.database, row.runKey), (ended) =>
    ended ? clearedPendingRow(parts.database, row.runKey) : givenToItsRun(parts, row),
  ).pipe(
    Effect.as(true),
    Effect.catchCause((failure: Cause.Cause<unknown>) =>
      Effect.as(
        trouble(`The cancel asked of ${row.runKey} could not be given; the next sweep gives it again`, failure),
        false,
      ),
    ),
  );
}

function pagesGiven(parts: PendingParts, trouble: Trouble, after: string): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.flatMap(pendingCancelRowsAfter(parts.database, after, pendingRowsInAPage), (rows) =>
    Effect.flatMap(
      Effect.forEach(rows, (row) => givenOrKept(parts, trouble, row), { concurrency: cancelsGivenAtOnce }),
      (given: readonly boolean[]) => {
        const allGiven = given.every(Boolean);
        const last = rows.at(-1);
        return last === undefined || rows.length < pendingRowsInAPage
          ? Effect.succeed(allGiven)
          : Effect.map(pagesGiven(parts, trouble, last.runKey), (rest) => allGiven && rest);
      },
    ),
  );
}

export function pendingCancelsGivenOnce(parts: PendingParts, trouble: Trouble): Effect.Effect<void> {
  const given = { once: false };
  return Effect.suspend(() =>
    given.once
      ? Effect.void
      : pagesGiven(parts, trouble, '').pipe(
          Effect.flatMap((allGiven) =>
            Effect.sync(() => {
              given.once = allGiven;
            }),
          ),
          Effect.catchCause((cause: Cause.Cause<unknown>) =>
            trouble('The cancels the follower passed over could not be read; the next sweep reads them again', cause),
          ),
        ),
  );
}
