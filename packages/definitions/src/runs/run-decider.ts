import { Conflict, type Decider } from '@on.auto/operations';
import { Equal, Result } from 'effect';

import type { AdmitsFact } from '../run-work/work-decisions.ts';
import type { RunCommand } from './run-commands.ts';
import { runContextOf } from './run-context.ts';
import { decideOnRun } from './run-decisions.ts';
import { RunEventSchema, runEventSchemaOf, type IsDeclared, type RecordedRunEvent } from './run-events.ts';
import { evolveRun, type RunStreamState } from './run-state.ts';

type RunReason = 'not_found' | 'conflict' | 'cancelled';

export type RunDecider = Decider<RunStreamState, RunCommand, RecordedRunEvent, RunReason>;

interface RunAsRead {
  readonly state: RunStreamState;
  readonly version: number;
}

interface CommandAsRead {
  readonly readAt: number;
  readonly command: RunCommand;
}

export type RunDeciderAsRead = Decider<RunAsRead, CommandAsRead, RecordedRunEvent, RunReason>;

export interface RunDeciders {
  readonly decider: RunDecider;
  readonly asRead: RunDeciderAsRead;
}

const changedSinceRead = new Conflict({
  detail: 'The run changed since it was read, so it is read again',
  kind: 'concurrent_change',
});

export function isChangedSinceRead(error: unknown): boolean {
  return Equal.equals(error, changedSinceRead);
}

function decidersOver(eventSchema: typeof RunEventSchema, admits: AdmitsFact): RunDeciders {
  const decide = (command: RunCommand, state: RunStreamState) => decideOnRun(command, state, admits);
  return {
    decider: { initialState: undefined, evolve: evolveRun, decide, context: runContextOf, eventSchema },
    asRead: {
      initialState: { state: undefined, version: 0 },
      evolve: ({ state, version }, event) => ({ state: evolveRun(state, event), version: version + 1 }),
      decide: ({ readAt, command }, { state, version }) =>
        readAt === version ? decide(command, state) : Result.fail(changedSinceRead),
      context: ({ command }, { state }) => runContextOf(command, state),
      eventSchema,
    },
  };
}

export function runDecidersOf(isDeclared: IsDeclared, admits: AdmitsFact): RunDeciders {
  return decidersOver(runEventSchemaOf(isDeclared), admits);
}

function knowsNoWork(): boolean {
  return false;
}

const readingAnyWork = decidersOver(RunEventSchema, knowsNoWork);

export const runDecider: RunDecider = readingAnyWork.decider;

export const runDeciderAsRead: RunDeciderAsRead = readingAnyWork.asRead;

export function runStreamNameOf(id: string): string {
  return `runs/${id}`;
}
