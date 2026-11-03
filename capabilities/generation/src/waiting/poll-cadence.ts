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

function withinTheWaits(wait: number): number {
  return Math.min(Math.max(wait, pollWaits.leastMs), pollWaits.mostMs);
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
