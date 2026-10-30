import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import type { RecordCause, RecordLineage } from '../run-log/run-store.ts';

function causeOf(input: RunInput, { resumed }: RunLogEvent): RecordCause {
  if (input.kind === 'started') {
    return { kind: 'start' };
  }
  if (input.kind === 'timer_fired') {
    return { kind: 'timer', timerId: input.timerId };
  }
  if (input.kind === 'cancel_requested' && input.cause !== undefined) {
    return { kind: 'given', id: input.cause };
  }
  return resumed === undefined || resumed === null
    ? { kind: 'none' }
    : { kind: 'resumed', step: { ...resumed, outcome: 'waiting' } };
}

export function recordLineageOf(input: RunInput, state: RunState, event: RunLogEvent): RecordLineage {
  return {
    cause: causeOf(input, event),
    attributes: input.kind === 'started' ? input.attributes : state.attributes,
  };
}
