import { RunContextSchema, factOf, type Context, type Decided, type Decider } from '@on.auto/operations';
import { Result } from 'effect';

import { RunLogEventSchema, type RunLogEvent } from '../run-log/run-event.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

export interface RunDecider {
  readonly initialState: RunState;
  readonly evolve: (state: RunState, event: RunLogEvent) => RunState;
  readonly decide: (input: RunInput, state: RunState) => Result.Result<readonly RunLogEvent[]>;
  readonly context: (input: RunInput, state: RunState) => Context;
}

export const RunLogRecordSchema = factOf('input_applied', RunLogEventSchema, RunContextSchema);

export type RunLogRecord = typeof RunLogRecordSchema.Type;

export function runLogRecordOf(event: RunLogEvent): Decided<RunLogRecord> {
  return { type: 'input_applied', data: event };
}

export function runLogDeciderOf(machine: RunDecider): Decider<RunState, RunInput, RunLogRecord> {
  return {
    initialState: machine.initialState,
    evolve: (state, { data }) => machine.evolve(state, data),
    decide: (input, state) =>
      Result.map(machine.decide(input, state), (events: readonly RunLogEvent[]) =>
        events.map((event) => runLogRecordOf(event)),
      ),
    context: machine.context,
    eventSchema: RunLogRecordSchema,
  };
}
