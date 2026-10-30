import type { StartedFields } from '@on.auto/tool-servers';

import type { DeliveryEnded, DeliveryStarted } from '../facts/run-facts.ts';
import { attemptInFlightMs } from '../requests/open-requests.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { attemptSchedule } from '../schedule/attempt-schedule.ts';
import type { AttemptEnd } from './attempt-end.ts';

export interface Attempting {
  readonly number: number;
  readonly target: string;
  readonly server: string;
  readonly tool: string;
}

export function startedFact(attempting: Attempting, call?: StartedFields): DeliveryStarted {
  const { number, target, server, tool } = attempting;
  return { type: 'delivery_started', data: { number, target, ...(call ?? { server, tool }) } };
}

export function endedFact(number: number, end: AttemptEnd, durationMs: number): DeliveryEnded {
  const ofTheAttempt = { number, duration_ms: durationMs };
  if (end.type === 'delivery_succeeded') {
    return { type: end.type, data: { ...ofTheAttempt, ...end.data } };
  }
  return end.type === 'delivery_failed'
    ? { type: end.type, data: { ...ofTheAttempt, ...end.data } }
    : { type: end.type, data: { ...ofTheAttempt, ...end.data } };
}

export function lostFact(row: OpenRequestRow): DeliveryEnded {
  return endedFact(row.attempts, { type: 'delivery_failed', data: { because: 'lost' } }, attemptInFlightMs);
}

export function isLastAttempt({ type }: Pick<AttemptEnd, 'type'>, number: number): boolean {
  return type === 'delivery_refused' || (type === 'delivery_failed' && number >= attemptSchedule.attempts);
}
