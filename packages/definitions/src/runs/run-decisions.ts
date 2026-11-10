import { Conflict, NotFound, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { endingOfADeadAttempt } from '../cancellation/dead-attempt-endings.ts';
import { decideAnswer, decideCall, decideWork, type AdmitsFact } from '../run-work/work-decisions.ts';
import { cancelledBeforeItsStart, claimOf, needsNoRun, takesAStartOnce } from './run-claims.ts';
import { askedOf } from './run-commands.ts';
import type {
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
  isRunning,
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

function startedEvent({ input, started_by, calls_tools, finishes_later, resumes, output_shape }: RunStart): RunEvent {
  return {
    type: 'run_started',
    data: {
      input,
      started_by,
      ...(calls_tools ? { calls_tools } : {}),
      ...(finishes_later === true ? { finishes_later } : {}),
      ...(resumes === true ? { resumes } : {}),
      ...(output_shape === undefined ? {} : { output_shape }),
    },
  };
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

function isDeferralAfterItsResult(result: RunOutcome, state: RecordedRunState): boolean {
  return result.type === 'run_deferred' && state.result !== undefined;
}

function leftToResume(result: RunOutcome | InterruptedAttempt, { cancel }: RecordedRunState): boolean {
  return result.type === 'run_interrupted' && result.resumes === true && cancel === undefined;
}

function decideFinish({ result, attempt }: RunFinish, state: RunState): Decision {
  if (state === undefined) {
    return nothingToRecord;
  }
  if (attempt !== undefined && attempt !== state.attempt) {
    return Result.fail(runTaken);
  }
  if (leftToResume(result, state)) {
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

function settledAlready({ result }: RecordedRunState, settlement: RunSettlement): Decision {
  return Result.flatMap(settledTheSame(result, settlement.result), (same): Decision =>
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
  if (withinItsCall && cancel.byItsCaller !== true) {
    return Result.fail(runsWithinItsCall);
  }
  const asked = run.cancel === undefined ? [cancelRequested(cancel)] : [];
  const ended = withinItsCall && cancel.attemptDied === true ? endingOfADeadAttempt(run, run.cancel ?? cancel) : [];
  return Result.succeed([...asked, ...ended]);
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
  if (command.type === 'resume') {
    return decideResume(command, run);
  }
  return command.type === 'finish' ? decideFinish(command, run) : decideSettlement(command, run);
}
