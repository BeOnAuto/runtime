import type { RecordedAnswer, Settlement } from '@on.auto/definitions';

import type { DeliveredRecord } from '../run/request-record.ts';
import { throughWords, type Route } from '../tool-blocks/routes.ts';

export function expiredSettlement({ expires_at: expiresAt }: { readonly expires_at: number }): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'expired',
    detail: `Nobody answered the request before it expired at ${new Date(expiresAt).toISOString()}`,
  };
}

export function answeredSettlement({ answer, by }: Pick<RecordedAnswer, 'answer' | 'by'>): Settlement {
  return { status: 'succeeded', output: answer, record: {}, by: by.id };
}

export function deliveredSettlement(at: string): Settlement {
  const record: DeliveredRecord = { delivered_at: at };
  return { status: 'succeeded', output: {}, record };
}

export function undeliveredSettlement(route: Route): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'undelivered',
    detail: `The notification could not be delivered ${throughWords(route)}, though every attempt was made`,
  };
}
