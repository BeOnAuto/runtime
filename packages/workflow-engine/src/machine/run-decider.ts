import { RunContextSchema, factOf, type Context, type Decided as DecidedFact } from '@on.auto/operations';
import type { PayloadToKeep } from '@on.auto/operations/payloads';
import type { Result } from 'effect';

import { RunLogEventSchema, type RunLogEvent } from '../run-log/run-event.ts';
import type { RunAtHand } from './held-contents.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

export interface InputDecision {
  readonly events: readonly RunLogEvent[];
  readonly payloads: readonly PayloadToKeep[];
}

export interface RunDecider {
  readonly initialState: RunState;
  readonly evolve: (state: RunState, event: RunLogEvent) => RunState;
  readonly decide: (input: RunInput, state: RunState) => Result.Result<readonly RunLogEvent[]>;
  readonly decision: (input: RunInput, state: RunState, atHand: RunAtHand) => InputDecision;
  readonly context: (input: RunInput, state: RunState) => Context;
}

export const RunLogRecordSchema = factOf('input_applied', RunLogEventSchema, RunContextSchema, {
  content: {
    payloads: [
      { sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' },
      { sha256: '/outputs/*/arguments_sha256', bytes: '/outputs/*/arguments_bytes' },
    ],
  },
});

export type RunLogRecord = typeof RunLogRecordSchema.Type;

export function runLogRecordOf(event: RunLogEvent): DecidedFact<RunLogRecord> {
  return { type: 'input_applied', data: event };
}
