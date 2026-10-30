import { clearTimeout, setTimeout } from 'node:timers';

import type { ModelFailure } from '../failure/model-failure.ts';
import { TimedOut } from '../failure/timed-out.ts';
import type { ModelRequest } from '../model/model-request.ts';

export interface Deadline {
  readonly signal: AbortSignal;
  readonly ms: number;
  readonly ended: () => void;
}

export function deadlineOf({ timeout_ms: ms }: ModelRequest): Deadline | undefined {
  if (ms === undefined) {
    return undefined;
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

export function stoppedFailure(provider: string, deadline: Deadline | undefined): ModelFailure | undefined {
  return deadline?.signal.aborted === true
    ? new TimedOut({ detail: `${provider} did not answer within ${deadline.ms} ms`, provider, timeout_ms: deadline.ms })
    : undefined;
}
