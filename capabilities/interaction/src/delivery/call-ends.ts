import type { AnsweredOnce, CallAnswer, CallAnswered, CallFailed, SentCallFailedBecause } from '@on.auto/tool-servers';

import type { DeliveryFailedBecause } from '../facts/run-facts.ts';

const becauseOf = {
  arguments_refused: 'arguments_refused',
  server_failure: 'server_failure',
  timed_out: 'timed_out',
  too_large: 'too_large',
  cancelled: 'lost',
} as const satisfies Readonly<Record<SentCallFailedBecause, DeliveryFailedBecause>>;

interface CallFailure {
  readonly because: 'tool_error' | (typeof becauseOf)[SentCallFailedBecause];
  readonly retryAfterMs: number | null;
  readonly detail: string;
  readonly fields: CallAnswered | CallFailed;
}

export type CallEnd =
  | { readonly answered: CallAnswer; readonly fields: CallAnswered }
  | { readonly failed: CallFailure };

export function endOfCall(called: AnsweredOnce): CallEnd {
  if (called.outcome === 'result') {
    return { answered: called.answer, fields: called.answered };
  }
  const { retryAfterMs, detail } = called;
  if (called.outcome === 'tool_error') {
    return { failed: { because: 'tool_error', retryAfterMs, detail, fields: called.answered } };
  }
  return { failed: { because: becauseOf[called.outcome], retryAfterMs, detail, fields: called.failed } };
}
