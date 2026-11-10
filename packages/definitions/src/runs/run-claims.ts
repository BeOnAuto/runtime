import { Conflict, playbookPayloadReader, type RunCancelled, type Unavailable } from '@on.auto/operations';
import { Effect, Equal, Result } from 'effect';

import {
  comparedPayloads,
  comparedWithoutItsValue,
  keptToCompare,
  type Compared,
} from '../payloads/payload-comparisons.ts';
import { valuesReadFor } from '../payloads/run-payloads.ts';
import { cancelledAsAsked } from '../run-work/work-decisions.ts';
import { askedOf, type RunAsked, type RunRequest } from './run-commands.ts';
import {
  awaitsSettlement,
  cancelBeforeStartOf,
  changedNothing,
  hasFinalResult,
  isRunning,
  mayHaveChangedSomething,
  startedRunOf,
  type RunState,
  type RunStreamState,
  type RecordedRunState,
} from './run-state.ts';
import { toolsOnlyRead, toolsWereCalled } from './tool-refusals.ts';

export type Claim =
  | { readonly type: 'run' }
  | { readonly type: 'answer' }
  | { readonly type: 'resume'; readonly run: RecordedRunState };

const runClaimed: Claim = { type: 'run' };

const answerClaimed: Claim = { type: 'answer' };

function requestComparedWith({ input, run }: RecordedRunState, asked: RunAsked): Compared {
  return run.type === asked.definition_type && run.name === asked.name
    ? comparedPayloads(input, asked.input, (recorded, offered) => Equal.equals(recorded, offered), asked.valuesRead)
    : 'different';
}

export function needsNoRun(state: RecordedRunState): boolean {
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

export function cancelledBeforeItsStart(state: RunStreamState): RunCancelled | undefined {
  const cancel = cancelBeforeStartOf(state);
  return cancel === undefined ? undefined : cancelledAsAsked(cancel);
}

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

export function claimOf(
  state: RunStreamState,
  asked: RunAsked,
  resumes = false,
): Result.Result<Claim, Conflict | RunCancelled | Unavailable> {
  const cancelled = cancelledBeforeItsStart(state);
  if (cancelled !== undefined) {
    return Result.fail(cancelled);
  }
  const run = startedRunOf(state);
  if (run === undefined) {
    return Result.succeed(runClaimed);
  }
  const compared = requestComparedWith(run, asked);
  if (compared === 'unknown') {
    return Result.fail(comparedWithoutItsValue);
  }
  return compared === 'different' ? Result.fail(anotherRequest) : claimOfRecorded(run, resumes);
}

function startsAgain(request: RunRequest, state: RecordedRunState): Compared {
  return !isRunning(state) && !needsNoRun(state) && !mayHaveChangedSomething(state)
    ? requestComparedWith(state, askedOf(request))
    : 'different';
}

export function takesAStartOnce(state: RunState, request: RunRequest): Result.Result<boolean, Unavailable> {
  if (state === undefined) {
    return Result.succeed(false);
  }
  const again = startsAgain(request, state);
  return again === 'unknown' ? Result.fail(comparedWithoutItsValue) : Result.succeed(again === 'different');
}

export const comparedWithItsRecordedInput = Effect.fnUntraced(function* (
  recorded: RunStreamState,
  request: RunRequest,
) {
  const run = startedRunOf(recorded);
  const kept = run === undefined ? [] : keptToCompare(run.input, { inline: request.input });
  if (kept.length === 0) {
    return request;
  }
  const valuesRead = yield* valuesReadFor(kept, yield* playbookPayloadReader);
  return { ...request, valuesRead } satisfies RunRequest;
});
