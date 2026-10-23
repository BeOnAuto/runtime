import { Effect } from 'effect';

import type { DueWork } from './due-work.ts';

export interface Chore {
  readonly name: string;
  readonly perform: (now: number) => Effect.Effect<number>;
}

export function choreWork({ name, perform }: Chore): DueWork {
  const due = { at: Number.NEGATIVE_INFINITY };
  const performed = (now: number) =>
    Effect.map(perform(now), (next) => {
      due.at = next;
    });
  return {
    name,
    due: (now, most, callsOut) =>
      Effect.succeed((callsOut && due.at <= now ? [{ key: name, callsOut, perform: performed }] : []).slice(0, most)),
    nextDueAt: (after) => Effect.succeed(due.at > after ? due.at : null),
  };
}
