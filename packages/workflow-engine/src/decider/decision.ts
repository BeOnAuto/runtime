import { staleReasonOf } from '../machine/admission.ts';
import type { InputDecision } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { DecidingOptions } from '../runner/run-descriptors.ts';
import { appliedEvents, nothingDecided, oneEvent } from './applied-events.ts';
import { applyingOf } from './given-answers.ts';
import { endingEvent } from './run-endings.ts';

export function decided(options: DecidingOptions, input: RunInput, state: RunState): InputDecision {
  const { contents } = options.atHand;
  if (staleReasonOf(state, input, contents) !== undefined) {
    return nothingDecided;
  }
  const applying = applyingOf(state, contents, input);
  return 'applied' in applying
    ? appliedEvents(state, options, applying.applied)
    : oneEvent(endingEvent(state, options, input, applying.ending));
}
