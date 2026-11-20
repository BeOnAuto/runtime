import { withinDetailBytes } from '@on.auto/definitions/goals';
import { Effect } from 'effect';

import { actingOf, type NoticePorts } from '../notices/notice-ledger.ts';
import { mostNoticeAttempts, retryDelayOf } from '../notices/notice-starts.ts';
import { summaryRecorded } from './summary-ledger.ts';
import type { Moment, Summary } from './summary-times.ts';

export function refusedForNow(
  ports: NoticePorts,
  summary: Summary,
  attempt: number,
  detail: string,
): Effect.Effect<Moment, unknown> {
  const { address, goal, due, now } = summary;
  const retried = attempt < mostNoticeAttempts;
  const retryAt = now + retryDelayOf(attempt);
  const words = retried ? detail : `${detail}; it was tried ${String(attempt)} times and is not tried again`;
  return Effect.as(
    summaryRecorded(ports.ledger, goal, {
      kind: 'refused',
      due,
      attempt,
      detail: withinDetailBytes(words),
      ...(retried ? { retry_at: new Date(retryAt).toISOString() } : {}),
      ...actingOf(address, now),
    }),
    retried ? retryAt : null,
  );
}

export function refusedOnce(
  ports: NoticePorts,
  summary: Summary,
  attempt: number,
  detail: string,
): Effect.Effect<Moment, unknown> {
  const { address, goal, due, now } = summary;
  return Effect.as(
    summaryRecorded(ports.ledger, goal, {
      kind: 'refused',
      due,
      attempt: attempt + 1,
      detail: withinDetailBytes(detail),
      ...actingOf(address, now),
    }),
    null,
  );
}
