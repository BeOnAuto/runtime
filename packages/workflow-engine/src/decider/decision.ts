import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { InputDecision } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { DecidingOptions } from '../runner/run-descriptors.ts';
import { resultOf } from './input-result.ts';
import { brokenBound, inputsBound, lostContentBound } from './run-bounds.ts';
import { endingEvent } from './run-endings.ts';
import { eventOf, type DecidedEvent } from './run-events.ts';

const nothingDecided: InputDecision = { events: [], payloads: [] };

function oneEvent({ event, payloads }: DecidedEvent): InputDecision {
  return { events: [event], payloads };
}

function appliedEvents(state: RunState, options: DecidingOptions, input: RunInput): InputDecision {
  const at = inputTimeOf(state, input);
  const result = resultOf(state, at, options, input);
  if (input.kind === 'event_offered' && result.offer?.kind !== 'accepted') {
    return nothingDecided;
  }
  const made = eventOf(state, result, receiptOf(input, at), options.atHand);
  const broken = brokenBound(state, made.event, result);
  return oneEvent(broken === undefined ? made : endingEvent(state, options, input, broken));
}

export function decided(options: DecidingOptions, input: RunInput, state: RunState): InputDecision {
  if (staleReasonOf(state, input, options.atHand.contents) !== undefined) {
    return nothingDecided;
  }
  const ending = lostContentBound(state, options.atHand.contents) ?? inputsBound(state);
  return ending === undefined
    ? appliedEvents(state, options, input)
    : oneEvent(endingEvent(state, options, input, ending));
}
