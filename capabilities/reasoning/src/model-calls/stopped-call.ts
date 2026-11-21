import { Function } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import { TimedOut } from '../failure/timed-out.ts';
import type { ModelRequest } from '../model/model-request.ts';

export interface Deadline {
  readonly signal: AbortSignal;
  readonly ms: number;
  readonly ended: () => void;
}

export type DeadlineAfter = (ms: number) => AbortSignal;

export function deadlineOf({ timeout_ms: ms }: ModelRequest, deadlineAfter?: DeadlineAfter): Deadline | undefined {
  if (ms === undefined) {
    return undefined;
  }
  if (deadlineAfter !== undefined) {
    return { signal: deadlineAfter(ms), ms, ended: Function.constVoid };
  }
  const missed = new AbortController();
  const timer = setTimeout(() => {
    missed.abort();
  }, ms).unref();
  return {
    signal: missed.signal,
    ms,
    ended: () => {
      clearTimeout(timer);
    },
  };
}

export function msLeftOf({ timeout_ms: timeoutMs, room }: ModelRequest, calledAt: number, now: number): number {
  const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : calledAt + timeoutMs;
  return Math.min(deadline, room?.ends_at ?? Number.POSITIVE_INFINITY) - now;
}

export function stoppedFailure(provider: string, deadline: Deadline | undefined): ModelFailure | undefined {
  return deadline?.signal.aborted === true
    ? new TimedOut({ detail: `${provider} did not answer within ${deadline.ms} ms`, provider, timeout_ms: deadline.ms })
    : undefined;
}
