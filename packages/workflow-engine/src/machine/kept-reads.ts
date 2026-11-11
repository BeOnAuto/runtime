import type { Digested } from '@on.auto/content';

import { staleReasonOf } from './admission.ts';
import { keptOutputOf } from './call-answers.ts';
import { keptValuesReached, nothingAtHand } from './held-contents.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

function keptOfTheInput(input: RunInput): readonly Digested[] {
  const kept = input.kind === 'call_answered' ? keptOutputOf(input.result) : undefined;
  return kept === undefined ? [] : [kept];
}

export function keptReadBefore(state: RunState, input: RunInput): readonly Digested[] {
  if (input.kind !== 'started' && staleReasonOf(state, input, nothingAtHand().contents) !== undefined) {
    return [];
  }
  const kept = [...keptValuesReached(state), ...keptOfTheInput(input)];
  return [...new Map(kept.map((each) => [each.sha256, each])).values()];
}
