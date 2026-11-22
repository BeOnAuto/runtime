import { Function } from 'effect';

import { countedCalls } from './counted-calls.ts';

interface RetryToken {
  readonly getRetryCount: () => number;
  readonly getRetryDelay: () => number;
}

interface RetryErrorInfo {
  readonly errorType: string;
}

interface RetryStrategy {
  readonly acquireInitialRetryToken: (scope: string) => Promise<RetryToken>;
  readonly refreshRetryTokenForRetry: (token: RetryToken, errorInfo: RetryErrorInfo) => Promise<RetryToken>;
  readonly recordSuccess: (token: RetryToken) => void;
}

export interface RetriesOnATimer {
  readonly retryStrategyOf: () => RetryStrategy;
  readonly paused: (count: number) => Promise<void>;
  readonly fire: () => void;
  readonly attempts: () => number;
  readonly retriedThrough: <A>(asking: Promise<A>) => Promise<A>;
}

class NoRetryLeft extends Error {}

function tokenOf(count: number): RetryToken {
  return { getRetryCount: () => count, getRetryDelay: () => 0 };
}

export function retriesOnATimer(mostAttempts = 3): RetriesOnATimer {
  const pauses = countedCalls<() => void>();
  const sent = { attempts: 0 };
  const resumeEvery = () => {
    for (const resume of pauses.calls()) {
      resume();
    }
  };
  const resumedFrom = async (pause: number): Promise<void> => {
    if (pause < mostAttempts) {
      await pauses.asked(pause);
      resumeEvery();
      await resumedFrom(pause + 1);
    }
  };
  const strategy: RetryStrategy = {
    acquireInitialRetryToken: () => {
      sent.attempts += 1;
      return Promise.resolve(tokenOf(0));
    },
    refreshRetryTokenForRetry: async (token, { errorType }) => {
      const count = token.getRetryCount() + 1;
      if (count >= mostAttempts || errorType === 'CLIENT_ERROR') {
        throw new NoRetryLeft(`No retry is left after ${String(count)} attempts`);
      }
      const resumed = Promise.withResolvers<void>();
      pauses.note(resumed.resolve);
      await resumed.promise;
      sent.attempts += 1;
      return tokenOf(count);
    },
    recordSuccess: Function.constVoid,
  };
  return {
    retryStrategyOf: () => strategy,
    paused: pauses.asked,
    fire: resumeEvery,
    attempts: () => sent.attempts,
    retriedThrough: async (asking) => {
      await resumedFrom(1);
      return asking;
    },
  };
}
