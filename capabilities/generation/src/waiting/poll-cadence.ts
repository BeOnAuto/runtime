import { gatewayAnswerMs } from '../gateway/generation-gateway.ts';

export const firstPollWaitMs = 5000;

export const pollWaits = {
  leastMs: firstPollWaitMs,
  mostWithoutProgressMs: 30_000,
  mostMs: 60_000,
  inFlightMs: 60_000,
  fetchMarginMs: 60_000,
} as const;

export interface PollEnd {
  readonly polls: number;
  readonly deferredAt: number;
  readonly now: number;
  readonly progress: number | null;
}

/**
 * A wait in whole milliseconds, between the least and the most: the times of the due rows are kept as integers. It is
 * rounded up, so no poll comes sooner than the progress asks; the bounds are whole, so rounding keeps it within them.
 */
function withinTheWaits(wait: number): number {
  return Math.ceil(Math.min(Math.max(wait, pollWaits.leastMs), pollWaits.mostMs));
}

export function waitAfterPoll({ polls, deferredAt, now, progress }: PollEnd): number {
  if (progress === null || progress <= 0) {
    return Math.min(firstPollWaitMs * 2 ** polls, pollWaits.mostWithoutProgressMs);
  }
  const remaining = progress >= 100 ? 0 : ((now - deferredAt) * (100 - progress)) / progress;
  return withinTheWaits(remaining / 2);
}

export function fetchInFlightMs(answerMs = gatewayAnswerMs): number {
  return answerMs + pollWaits.fetchMarginMs;
}
