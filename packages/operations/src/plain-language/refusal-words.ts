import type { RejectionReason } from '../outcome/outcome.ts';

const refusalByReason: Readonly<Record<RejectionReason, string>> = {
  invalid_input: 'refused its input',
  unavailable: 'was not available',
  not_found: 'could not be found',
  forbidden: 'was not allowed',
  conflict: 'could not go through',
  cancelled: 'was cancelled',
  unanswered: 'went unanswered',
};

const refusedForAnotherReason = 'did not go through';

function isRejectionReason(reason: string): reason is RejectionReason {
  return Object.hasOwn(refusalByReason, reason);
}

export function refusalInWords(reason: string): string {
  return isRejectionReason(reason) ? refusalByReason[reason] : refusedForAnotherReason;
}
