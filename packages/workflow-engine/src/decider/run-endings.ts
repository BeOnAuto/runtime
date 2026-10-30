import type { DslError } from '../machine/dsl-error.ts';
import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import type { DecidingOptions } from '../runner/run-descriptors.ts';
import { sessionOf } from '../runner/session.ts';
import { eventOf } from './run-events.ts';

export function endingEvent(state: RunState, options: DecidingOptions, input: RunInput, error: DslError): RunLogEvent {
  const at = inputTimeOf(state, input);
  const session = sessionOf(state, at, options);
  if (input.kind === 'started') {
    session.begin({ ...input, document: {}, input: session.hold(null) });
  }
  session.end({ kind: 'raised', error });
  return eventOf(state, session.result(), receiptOf(input, at));
}
