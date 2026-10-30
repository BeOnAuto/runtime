import { Effect } from 'effect';

import { declinedOfferOf } from '../decider/declined-offers.ts';
import { outcomeOf, staleReasonOf } from '../machine/admission.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import type { RunDecision } from './run-loop.ts';
import type { Submission } from './workflow-engine.ts';

export function submissionOf({ events, loaded, version }: RunDecision, input: RunInput): Submission {
  return {
    outcome: events.length > 0 ? 'applied' : outcomeOf(staleReasonOf(loaded.state, input) ?? 'offer_declined'),
    version,
  };
}

export function submissionWithDeclined(
  decision: RunDecision,
  input: RunInput,
  options: MachineOptions,
): Effect.Effect<Submission> {
  const submission = submissionOf(decision, input);
  if (decision.events.length > 0 || input.kind !== 'event_offered') {
    return Effect.succeed(submission);
  }
  return Effect.map(options.sandbox.reserve, () => {
    const declined = declinedOfferOf(options, input, decision.loaded.state);
    return declined === undefined ? submission : { ...submission, declined };
  });
}
