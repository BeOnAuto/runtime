import { describeError } from '../dsl/raised-error.ts';
import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf } from '../machine/input-receipt.ts';
import type { EventOffered } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { deciding } from './deciding.ts';
import { resultOf } from './input-result.ts';

export function declinedOfferOf(options: MachineOptions, input: EventOffered, state: RunState): string | undefined {
  if (staleReasonOf(state, input) !== undefined) {
    return undefined;
  }
  const { offer } = deciding(options, (withUnit) => resultOf(state, inputTimeOf(state, input), withUnit, input));
  return offer?.kind === 'failed' ? describeError(offer.error) : undefined;
}
