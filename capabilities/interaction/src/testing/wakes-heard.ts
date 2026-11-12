import { Effect } from 'effect';

import type { ConnectionWake, WokenConnection } from '../wakes/connection-wakes.ts';

export interface HeardWake extends WokenConnection {
  readonly at: number;
}

export interface WakesHeard {
  readonly wake: ConnectionWake;
  readonly heard: () => readonly HeardWake[];
}

export function wakesHeard(): WakesHeard {
  const heard: HeardWake[] = [];
  return {
    wake: (woken, now) =>
      Effect.sync(() => {
        heard.push({ ...woken, at: now });
      }),
    heard: () => [...heard],
  };
}
