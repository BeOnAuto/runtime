import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';

export interface Timer {
  readonly after: (ms: number, expire: () => void) => () => void;
}

export const systemTimer: Timer = {
  after: (ms, expire) => {
    const timeout = setTimeout(expire, ms);
    return () => {
      clearTimeout(timeout);
    };
  },
};

export const longestSdkTimeoutMs = 2_147_483_647;

export async function withinBound<A>(timer: Timer, ms: number, run: (signal: AbortSignal) => Promise<A>): Promise<A> {
  const bound = new AbortController();
  const stop = timer.after(ms, () => {
    bound.abort(new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'));
  });
  try {
    return await run(bound.signal);
  } finally {
    stop();
  }
}

export function pausedFor(
  timer: Timer,
  ms: number,
  signal: Readonly<AbortSignal> = new AbortController().signal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  const paused = Promise.withResolvers<void>();
  const stop = timer.after(ms, paused.resolve);
  const given = () => {
    stop();
    paused.resolve();
  };
  signal.addEventListener('abort', given, { once: true });
  return paused.promise.finally(() => {
    signal.removeEventListener('abort', given);
  });
}

export async function raceAgainst<A, B>(timer: Timer, ms: number, waited: Promise<A>, late: B): Promise<A | B> {
  const expired = Promise.withResolvers<B>();
  const stop = timer.after(ms, () => {
    expired.resolve(late);
  });
  try {
    return await Promise.race([waited, expired.promise]);
  } finally {
    stop();
  }
}
