import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { InputDecision } from '../machine/run-decider.ts';
import type { AppliedInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { DecidingOptions } from '../runner/run-descriptors.ts';
import { resultOf } from './input-result.ts';
import { brokenBound } from './run-bounds.ts';
import { endingEvent } from './run-endings.ts';
import { eventOf, type DecidedEvent } from './run-events.ts';

export const nothingDecided: InputDecision = { events: [], payloads: [] };

export function oneEvent({ event, payloads }: DecidedEvent): InputDecision {
  return { events: [event], payloads };
}

export function appliedEvents(state: RunState, options: DecidingOptions, input: AppliedInput): InputDecision {
  const at = inputTimeOf(state, input);
  const result = resultOf(state, at, options, input);
  if (input.kind === 'event_offered' && result.offer?.kind !== 'accepted') {
    return nothingDecided;
  }
  const made = eventOf(state, result, receiptOf(input, at), options.atHand);
  const broken = brokenBound(state, made.event, result);
  return oneEvent(broken === undefined ? made : endingEvent(state, options, input, broken));
}
