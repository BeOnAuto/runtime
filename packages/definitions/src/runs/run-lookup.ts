import {
  Conflict,
  InvalidInput,
  NotFound,
  RunCancelled,
  RunUnanswered,
  Unavailable,
  type PlaybookContext,
  type PlaybookReader,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { withItsOutputRead } from './run-payloads.ts';
import { startedRunOf, type RunStreamState, type RecordedRunState } from './run-state.ts';
import type { RunAsRecorded, RunDetail, RunDetailAsRecorded, RunRejection, RunWithin } from './run.ts';

export function noRunCalled(id: string): NotFound {
  return new NotFound({ detail: `There is no run ${id} in this playbook` });
}

function recorded(id: string, stream: RunStreamState): Effect.Effect<RecordedRunState, NotFound> {
  const state = startedRunOf(stream);
  return state === undefined ? Effect.fail(noRunCalled(id)) : Effect.succeed(state);
}

const leadingSlash = /^\//u;

function withinOf({ calledBy }: RecordedRunState): { readonly within?: RunWithin } {
  return calledBy === undefined
    ? {}
    : { within: { run_id: calledBy.runId, step: calledBy.reference.replace(leadingSlash, '') } };
}

function shownRunOf(id: string, recordedRun: RecordedRunState): RunAsRecorded {
  return { run_id: id, ...recordedRun.run, ...withinOf(recordedRun) };
}

export function runOf(id: string, state: RunStreamState): Effect.Effect<RunAsRecorded, NotFound> {
  return recorded(id, state).pipe(Effect.map((recordedRun) => shownRunOf(id, recordedRun)));
}

function detailOf(id: string, recordedRun: RecordedRunState): RunDetailAsRecorded {
  const { record } = recordedRun;
  const run = shownRunOf(id, recordedRun);
  return record === undefined ? run : { ...run, record };
}

export function runDetailOf(id: string, state: RunStreamState): Effect.Effect<RunDetailAsRecorded, NotFound> {
  return recorded(id, state).pipe(Effect.map((run) => detailOf(id, run)));
}

type ReplayedRejection = InvalidInput | Unavailable | Conflict | RunCancelled | RunUnanswered;

function replayed(rejection: RunRejection): ReplayedRejection {
  if (rejection.reason === 'invalid_input') {
    const { detail, issues, kind } = rejection;
    return new InvalidInput({ detail, issues, ...(kind === undefined ? {} : { kind }) });
  }
  if (rejection.reason === 'unavailable') {
    const { detail, kind, because } = rejection;
    return new Unavailable({
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    });
  }
  if (rejection.reason === 'cancelled') {
    return new RunCancelled({ detail: rejection.detail, kind: rejection.kind });
  }
  if (rejection.reason === 'unanswered') {
    return new RunUnanswered({ detail: rejection.detail, kind: rejection.kind });
  }
  const { detail, kind, because } = rejection;
  return new Conflict({
    detail,
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
  });
}

function answerWith(
  run: RunDetailAsRecorded,
): Effect.Effect<RunDetail, ReplayedRejection, PlaybookReader | PlaybookContext> {
  return run.rejection === undefined ? withItsOutputRead(run) : Effect.fail(replayed(run.rejection));
}

export function runAnswered(
  id: string,
  state: RunStreamState,
): Effect.Effect<RunDetail, NotFound | ReplayedRejection, PlaybookReader | PlaybookContext> {
  return runDetailOf(id, state).pipe(Effect.flatMap(answerWith));
}
