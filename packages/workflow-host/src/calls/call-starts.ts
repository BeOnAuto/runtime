import type { CallResult } from '@on.auto/operations';
import {
  callKeyText,
  type CallKey,
  type OutputOrigin,
  type RunContext,
  type StartCall,
  type StartReceipt,
} from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { correlationOfRun } from '../runs/run-lineage.ts';
import { currentSpanIdentity, type SpanIdentity } from '../runs/run-spans.ts';
import { existingRowOf, openCallsUnder, refusedRow, startedRow, type CallRow } from './call-rows.ts';

export interface CallAttempt {
  readonly attemptDied: boolean;
}

const firstAttempt: CallAttempt = { attemptDied: false };

export const afterAnAttemptDied: CallAttempt = { attemptDied: true };

export interface Starting {
  readonly call: StartCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
}

export interface StartParts {
  readonly database: HostDatabase;
  readonly mostOpen: number;
  readonly childOf: (call: StartCall, run: RunContext) => string | null;
}

export interface StartingCalls {
  readonly begin: (key: string, starting: Starting, attempt: CallAttempt, parent?: SpanIdentity) => void;
  readonly answerAgain: (key: string, callKey: CallKey, result: CallResult) => void;
  readonly isRunning: (key: string) => boolean;
  readonly underItsRoot: <A, E>(root: string, work: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

function tooManyOpen(mostOpen: number): CallResult {
  return {
    status: 'rejected',
    reason: 'conflict',
    detail: `The runs under the run at the top of this tree already wait for ${mostOpen} calls, the most one tree of runs may have open, so this call was not started`,
  };
}

function startedOnce(
  { database, mostOpen, childOf }: StartParts,
  calls: StartingCalls,
  { call, run, origin }: Starting,
): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.gen(function* () {
    const key = callKeyText(call.key);
    const root = correlationOfRun(run.runId, run.attributes);
    const open = yield* openCallsUnder(database, root);
    if (open >= mostOpen) {
      const refusal = tooManyOpen(mostOpen);
      const refused = yield* refusedRow(database, key, run, refusal);
      if (refused) {
        calls.answerAgain(key, call.key, refusal);
      }
      return refused;
    }
    const inserted = yield* startedRow(database, key, { call, run, origin, child: childOf(call, run), root });
    if (inserted) {
      calls.begin(key, { call, run, origin }, firstAttempt, yield* currentSpanIdentity);
    }
    return inserted;
  }).pipe((counted) => calls.underItsRoot(correlationOfRun(run.runId, run.attributes), counted));
}

function startedAgain(
  calls: StartingCalls,
  starting: Starting,
  { state, result }: CallRow,
  parent: SpanIdentity | undefined,
): StartReceipt {
  const { call } = starting;
  const key = callKeyText(call.key);
  if (state === 'cancelled') {
    return 'refused_after_cancel';
  }
  if (state === 'answered' && result !== null) {
    calls.answerAgain(key, call.key, result);
    return 'answered_again';
  }
  if (state === 'waiting' || calls.isRunning(key)) {
    return 'running';
  }
  calls.begin(key, starting, afterAnAttemptDied, parent);
  return 'started_again';
}

export function started(
  parts: StartParts,
  calls: StartingCalls,
  starting: Starting,
): Effect.Effect<StartReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    if (yield* startedOnce(parts, calls, starting)) {
      return 'started';
    }
    const row = yield* existingRowOf(parts.database, callKeyText(starting.call.key));
    return startedAgain(calls, starting, row, yield* currentSpanIdentity);
  });
}
