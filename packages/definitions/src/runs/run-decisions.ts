import { Conflict, NotFound, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { endingOfADeadAttempt, endingOfAnAttemptThatDied } from '../cancellation/dead-attempt-endings.ts';
import { decideAnswer, decideCall, decideWork, runEnded, type AdmitsFact } from '../run-work/work-decisions.ts';
import { cancelledBeforeItsStart, claimOf, needsNoRun, takesAStartOnce } from './run-claims.ts';
import { askedOf, startedEvent } from './run-commands.ts';
import type {
  FinishingAttempt,
  RunAttemptDied,
  RunCall,
  RunCancel,
  RunCommand,
  RunFinish,
  RunOutcome,
  RunResume,
  RunSettlement,
  RunStart,
  InterruptedAttempt,
} from './run-commands.ts';
import type { RunEvent } from './run-events.ts';
import {
  cancelBeforeStartOf,
  endsWithinItsCall,
  holdsTheRun,
  isFinalResult,
  isRunning,
  startedByAnotherAttempt,
  startedRunOf,
  takesSettlement,
  type RunState,
  type RunStreamState,
  type RecordedRunState,
} from './run-state.ts';
import { settledTheSame } from './settlement-keys.ts';
import { startedCallingTools } from './tool-refusals.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'not_found' | 'conflict' | 'cancelled' | 'unavailable'>>;

const nothingToRecord: Decision = Result.succeed([]);

const noSuchRun = new NotFound({ detail: 'There is no such run in this playbook' });

export const runTaken = new Conflict({
  detail: 'A run under this id is going or has ended with a result, so this start records nothing',
  kind: 'taken',
});

export function isTaken(error: unknown): error is Conflict {
  return error instanceof Conflict && error.kind === runTaken.kind;
}

export function attemptIsLive(quietMs: number, resumesAfterMs: number): boolean {
  return quietMs <= resumesAfterMs;
}

export const stillRunning = new Conflict({
  detail:
    'The run is still running, so this request makes no second attempt of it; read it with get_run, or ask again once it has ended',
  kind: 'taken',
});

export const endedBeforeCancelling = new Conflict({
  detail: 'The run has already ended, so there is nothing left to cancel',
});

const runsWithinItsCall = new Conflict({
  detail:
    'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
});

function startedCallingToolsBefore(start: RunStart, state: RunState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function decideCreateOnly(start: RunStart, state: RunState): Decision {
  return Result.flatMap(takesAStartOnce(state, start), (taken): Decision =>
    taken ? Result.fail(runTaken) : Result.succeed([startedEvent(start)]),
  );
}

function decideStart(start: RunStart, state: RunStreamState): Decision {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  if (start.createOnly === true) {
    return decideCreateOnly(start, startedRunOf(state));
  }
  return Result.flatMap(claimOf(state, askedOf(start), start.resumes === true), (claim): Decision => {
    if (claim.type === 'answer') {
      return nothingToRecord;
    }
    if (claim.type === 'resume') {
      return Result.fail(stillRunning);
    }
    return startedCallingToolsBefore(start, startedRunOf(state))
      ? Result.fail(startedCallingTools)
      : Result.succeed([startedEvent(start)]);
  });
}

function outcomeOfAttempt(result: RunOutcome | InterruptedAttempt, { cancel }: RecordedRunState): RunOutcome {
  if (result.type !== 'run_interrupted') {
    return result;
  }
  if (cancel === undefined) {
    return { type: 'run_failed', data: {} };
  }
  const rejection = { reason: 'cancelled' as const, kind: cancel.kind, detail: cancel.reason };
  return {
    type: 'run_rejected',
    data: { rejection, ...(result.record === undefined ? {} : { record: result.record }) },
  };
}

function leftToResume(result: RunOutcome | InterruptedAttempt, { cancel }: RecordedRunState): boolean {
  return result.type === 'run_interrupted' && result.resumes === true && cancel === undefined;
}

function agreesWithTheHolder({ version }: FinishingAttempt, { run, holderStartedACall }: RecordedRunState): boolean {
  return version === run.definition_version && !holderStartedACall;
}

function mayRecordItsResult(attempt: FinishingAttempt, state: RecordedRunState): boolean {
  return holdsTheRun(attempt.fencingToken, state) ? isRunning(state) : agreesWithTheHolder(attempt, state);
}

function decideFinish({ result, attempt }: RunFinish, state: RunState): Decision {
  if (state === undefined || needsNoRun(state)) {
    return nothingToRecord;
  }
  const outcome = outcomeOfAttempt(result, state);
  if (isFinalResult(outcome) && mayRecordItsResult(attempt, state)) {
    return Result.succeed([outcome]);
  }
  if (!holdsTheRun(attempt.fencingToken, state)) {
    return Result.fail(runTaken);
  }
  return !isRunning(state) || leftToResume(result, state) ? nothingToRecord : Result.succeed([outcome]);
}

export const endedWithAnotherResult = new Conflict({ detail: 'The run already ended with another result' });

export const answeredFirst = new Conflict({
  detail: 'The run took an answer, so it did not go unanswered; that answer settles it',
});

function unansweredThoughAnswered({ answer }: RecordedRunState, { result }: RunSettlement): boolean {
  return answer !== null && result.type === 'run_rejected' && result.data.rejection.reason === 'unanswered';
}

function settledAlready({ result }: RecordedRunState, settlement: RunSettlement): Decision {
  return Result.flatMap(settledTheSame(result, settlement.result, settlement.valuesRead), (same): Decision =>
    same ? nothingToRecord : Result.fail(endedWithAnotherResult),
  );
}

function decideSettlement(settlement: RunSettlement, state: RunState): Decision {
  if (state === undefined) {
    return Result.fail(noSuchRun);
  }
  if (!isRunning(state)) {
    return settledAlready(state, settlement);
  }
  if (unansweredThoughAnswered(state, settlement)) {
    return Result.fail(answeredFirst);
  }
  return takesSettlement(state)
    ? Result.succeed([settlement.result])
    : Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      );
}

function decideResume({ attempt }: RunResume, state: RunState): Decision {
  return state !== undefined && state.resumes && isRunning(state) && attempt === state.attempt + 1
    ? Result.succeed([{ type: 'attempt_resumed', data: { attempt } }])
    : Result.fail(stillRunning);
}

function cancelRequested({ kind, reason }: RunCancel): RunEvent {
  return { type: 'run_cancel_requested', data: { kind, reason } };
}

function cancelOfARun(cancel: RunCancel, run: RecordedRunState): Decision {
  if (!isRunning(run)) {
    return Result.fail(endedBeforeCancelling);
  }
  const withinItsCall = endsWithinItsCall(run);
  if (withinItsCall && cancel.byItsCaller !== true && cancel.attemptDied !== true) {
    return Result.fail(runsWithinItsCall);
  }
  const asked = run.cancel === undefined ? [cancelRequested(cancel)] : [];
  const ended = withinItsCall && cancel.attemptDied === true ? endingOfADeadAttempt(run, run.cancel ?? cancel) : [];
  return Result.succeed([...asked, ...ended]);
}

const outlivesItsCall = new Conflict({
  detail:
    'The run outlives the call that started it, so an attempt of it that died is resumed or settled, never ended in its place',
});

export function isOutlivingItsCall(error: unknown): boolean {
  return error === outlivesItsCall;
}

function endingOfItsAttempt(state: RecordedRunState): readonly RunEvent[] {
  return state.cancel === undefined ? endingOfAnAttemptThatDied(state) : endingOfADeadAttempt(state, state.cancel);
}

function endsWithItsAttempt({ noNextAttempt }: RunAttemptDied, state: RecordedRunState): boolean {
  return endsWithinItsCall(state) || (noNextAttempt === true && !takesSettlement(state));
}

function decideAttemptDied(command: RunAttemptDied, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (!holdsTheRun(command.fencingToken, state)) {
    return Result.fail(runTaken);
  }
  return endsWithItsAttempt(command, state) ? Result.succeed(endingOfItsAttempt(state)) : Result.fail(outlivesItsCall);
}

function decideCallOfAnAttempt(command: RunCall, state: RunState): Decision {
  return startedByAnotherAttempt(command, state) ? Result.fail(runTaken) : decideCall(command, state);
}

function decideCancel(cancel: RunCancel, state: RunStreamState): Decision {
  if (cancelBeforeStartOf(state) !== undefined) {
    return nothingToRecord;
  }
  const run = startedRunOf(state);
  if (run !== undefined) {
    return cancelOfARun(cancel, run);
  }
  return cancel.byItsCaller === true ? Result.succeed([cancelRequested(cancel)]) : Result.fail(noSuchRun);
}

export function decideOnRun(command: RunCommand, state: RunStreamState, admits: AdmitsFact): Decision {
  if (command.type === 'start') {
    return decideStart(command, state);
  }
  if (command.type === 'cancel') {
    return decideCancel(command, state);
  }
  const run = startedRunOf(state);
  if (command.type === 'call') {
    return decideCallOfAnAttempt(command, run);
  }
  if (command.type === 'work') {
    return decideWork(command, run, admits);
  }
  if (command.type === 'answer') {
    return decideAnswer(command, run);
  }
  if (command.type === 'resume') {
    return decideResume(command, run);
  }
  if (command.type === 'attempt_died') {
    return decideAttemptDied(command, run);
  }
  return command.type === 'finish' ? decideFinish(command, run) : decideSettlement(command, run);
}
