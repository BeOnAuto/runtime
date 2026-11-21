import { onTestFinished, vi } from 'vitest';

export const longerThanTheTestMs = 120_000;

/** Fakes the timers and the clock a pool reads on the thread of the test, while its workers run on real threads. */
export function fakePoolTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

export interface Watched {
  readonly controller: AbortController;
  readonly watched: Promise<void>;
}

/** An abort controller whose `watched` resolves once something listens on its signal, which only its abort fires. */
export function watchedController(): Watched {
  const controller = new AbortController();
  const { promise, resolve } = Promise.withResolvers<void>();
  const { signal } = controller;
  const listen = signal.addEventListener.bind(signal);
  Object.defineProperty(signal, 'addEventListener', {
    value: (type: unknown, listener: unknown, options: unknown) => {
      Reflect.apply(listen, undefined, [type, listener, options]);
      resolve();
    },
  });
  return { controller, watched: promise };
}

export function afterFakeTime<Outcome>(milliseconds: number, outcome: Promise<Outcome>): Promise<Outcome> {
  return vi.advanceTimersByTimeAsync(milliseconds).then(() => outcome);
}
