import { Conflict, NotFound, type RunCancelled, type Rejection } from '@on.auto/operations';
import { Equal, Result } from 'effect';

import { cancelledAsAsked, decideAnswer, decideCall, decideWork, type AdmitsFact } from '../run-work/work-decisions.ts';
import type {
  RunCancel,
  RunCommand,
  RunFinish,
  RunOutcome,
  RunRequest,
  RunSettlement,
  RunStart,
  InterruptedAttempt,
} from './run-commands.ts';
import type { RunEvent } from './run-events.ts';
import {
  awaitsSettlement,
  cancelBeforeStartOf,
  changedNothing,
  hasFinalResult,
  isRunning,
  mayHaveChangedSomething,
  startedRunOf,
  takesSettlement,
  type RunState,
  type RunStreamState,
  type RecordedRunState,
} from './run-state.ts';
import { settlementKeyOf } from './settlement-keys.ts';
import { startedCallingTools, toolsOnlyRead, toolsWereCalled } from './tool-refusals.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'not_found' | 'conflict' | 'cancelled'>>;

export type Claim =
  | { readonly type: 'run' }
  | { readonly type: 'answer' }
  | { readonly type: 'resume'; readonly run: RecordedRunState };

const runClaimed: Claim = { type: 'run' };

const answerClaimed: Claim = { type: 'answer' };

const nothingToRecord: Decision = Result.succeed([]);

const noSuchRun = new NotFound({ detail: 'There is no such run in this playbook' });

export const runTaken = new Conflict({
  detail: 'A run under this id is going or has ended with a result, so this start records nothing',
  kind: 'taken',
});

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

function isSameRequest({ input, run }: RecordedRunState, request: RunRequest): boolean {
  return run.type === request.definition_type && run.name === request.name && Equal.equals(input, request.input);
}

function needsNoRun(state: RecordedRunState): boolean {
  return hasFinalResult(state) || awaitsSettlement(state);
}

function claimOfRecorded(state: RecordedRunState, resumes: boolean): Result.Result<Claim, Conflict> {
  if (needsNoRun(state)) {
    return Result.succeed(answerClaimed);
  }
  if (resumes && isRunning(state)) {
    return Result.succeed({ type: 'resume', run: state });
  }
  if (changedNothing(state)) {
    return Result.fail(toolsOnlyRead);
  }
  return mayHaveChangedSomething(state) ? Result.fail(toolsWereCalled) : Result.succeed(runClaimed);
}

function cancelledBeforeItsStart(state: RunStreamState): RunCancelled | undefined {
  const cancel = cancelBeforeStartOf(state);
  return cancel === undefined ? undefined : cancelledAsAsked(cancel);
}

export function claimOf(
  state: RunStreamState,
  request: RunRequest,
  resumes = false,
): Result.Result<Claim, Conflict | RunCancelled> {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  const run = startedRunOf(state);
  if (run === undefined) {
    return Result.succeed(runClaimed);
  }
  if (!isSameRequest(run, request)) {
    return Result.fail(
      new Conflict({ detail: 'The run id belongs to a run of another definition or with another input' }),
    );
  }
  return claimOfRecorded(run, resumes);
}

function startedCallingToolsBefore(start: RunStart, state: RunState): boolean {
  return state !== undefined && isRunning(state) && (state.callsTools || start.calls_tools);
}

function startedEvent({ input, calls_tools, finishes_later, resumes, output_shape }: RunStart): RunEvent {
  return {
    type: 'run_started',
    data: {
      input,
      ...(calls_tools ? { calls_tools } : {}),
      ...(finishes_later === true ? { finishes_later } : {}),
      ...(resumes === true ? { resumes } : {}),
      ...(output_shape === undefined ? {} : { output_shape }),
    },
  };
}

function startsAgain(start: RunStart, state: RecordedRunState): boolean {
  return !isRunning(state) && !needsNoRun(state) && !mayHaveChangedSomething(state) && isSameRequest(state, start);
}

function decideCreateOnly(start: RunStart, state: RunState): Decision {
  return state === undefined || startsAgain(start, state)
    ? Result.succeed([startedEvent(start)])
    : Result.fail(runTaken);
}

function decideStart(start: RunStart, state: RunStreamState): Decision {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  if (start.createOnly === true) {
    return decideCreateOnly(start, startedRunOf(state));
  }
  return Result.flatMap(claimOf(state, start, start.resumes === true), (claim): Decision => {
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

function isDeferralAfterItsResult(result: RunOutcome, state: RecordedRunState): boolean {
  return result.type === 'run_deferred' && state.result !== undefined;
}

function leftToResume(result: RunOutcome | InterruptedAttempt, { cancel }: RecordedRunState): boolean {
  return result.type === 'run_interrupted' && result.resumes === true && cancel === undefined;
}

function decideFinish({ result }: RunFinish, state: RunState): Decision {
  if (state === undefined || leftToResume(result, state)) {
    return nothingToRecord;
  }
  const outcome = outcomeOfAttempt(result, state);
  return needsNoRun(state) || isDeferralAfterItsResult(outcome, state) ? nothingToRecord : Result.succeed([outcome]);
}

export const endedWithAnotherResult = new Conflict({ detail: 'The run already ended with another result' });

export const answeredFirst = new Conflict({
  detail: 'The run took an answer, so it did not go unanswered; that answer settles it',
});

function unansweredThoughAnswered({ answer }: RecordedRunState, { result }: RunSettlement): boolean {
  return answer !== null && result.type === 'run_rejected' && result.data.rejection.reason === 'unanswered';
}

function settledAlready(state: RecordedRunState, settlement: RunSettlement): Decision {
  return state.result !== undefined && settlementKeyOf(state.result) === settlementKeyOf(settlement.result)
    ? nothingToRecord
    : Result.fail(endedWithAnotherResult);
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

function cancelRequested({ kind, reason }: RunCancel): RunEvent {
  return { type: 'run_cancel_requested', data: { kind, reason } };
}

function cancelOfARun(cancel: RunCancel, run: RecordedRunState): Decision {
  if (!isRunning(run)) {
    return Result.fail(endedBeforeCancelling);
  }
  if (!takesSettlement(run) && !run.resumes && cancel.byItsCaller !== true) {
    return Result.fail(runsWithinItsCall);
  }
  return run.cancel === undefined ? Result.succeed([cancelRequested(cancel)]) : nothingToRecord;
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
    return decideCall(command, run);
  }
  if (command.type === 'work') {
    return decideWork(command, run, admits);
  }
  if (command.type === 'answer') {
    return decideAnswer(command, run);
  }
  return command.type === 'finish' ? decideFinish(command, run) : decideSettlement(command, run);
}
