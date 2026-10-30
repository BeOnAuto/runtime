import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

import { RunEventSchema, type RecordedRunEvent, type RecordedRunFact } from './run-events.ts';

export type RunEnding = RecordedRunFact<'run_succeeded' | 'run_rejected' | 'run_failed'>;

export type CancelRequested = RecordedRunFact<'run_cancel_requested'>;

const decodeRunEvent = recordedDecoder(RunEventSchema);

function isEnding(event: RecordedRunEvent): event is RunEnding {
  return event.type === 'run_succeeded' || event.type === 'run_rejected' || event.type === 'run_failed';
}

function isCancelRequest(event: RecordedRunEvent): event is CancelRequested {
  return event.type === 'run_cancel_requested';
}

export function runEndingOf(recorded: unknown): RunEnding | undefined {
  return Option.getOrUndefined(Option.filter(decodeRunEvent(recorded), isEnding));
}

export function lastEndingOf(recorded: readonly unknown[]): RunEnding | undefined {
  return runEndingOf(recorded.at(-1));
}

export function cancelRequestOf(recorded: unknown): CancelRequested | undefined {
  return Option.getOrUndefined(Option.filter(decodeRunEvent(recorded), isCancelRequest));
}
