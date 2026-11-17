import { Effect } from 'effect';

import type { AssessmentState } from '../assessments/assessment-state.ts';
import type { ChainOrigins, OutsideEvent } from './chain-origins.ts';

export const mostRunsWalkedForAPage = 200;

export interface ActOfARun {
  readonly run: string;
  readonly at: number;
}

export function actsOf({ marks, measurement }: AssessmentState): readonly ActOfARun[] {
  return [...marks, ...(measurement === undefined ? [] : [measurement])].map(({ run, at }) => ({ run, at }));
}

export type OutsideEventOfARun<E> = (run: string) => Effect.Effect<string | undefined, E>;

export function outsideEventsOf<E>(origins: ChainOrigins<E>): OutsideEventOfARun<E> {
  const walked = new Map<string, string | undefined>();
  return (run) => {
    if (walked.has(run) || walked.size >= mostRunsWalkedForAPage) {
      return Effect.succeed(walked.get(run));
    }
    return Effect.map(origins.chainOf({ run }), ({ outside }) => {
      walked.set(run, outside?.id);
      return outside?.id;
    });
  };
}

export function sharesTheEvent<E>(
  began: OutsideEventOfARun<E>,
  acts: readonly ActOfARun[],
  outside: OutsideEvent | undefined,
): Effect.Effect<boolean, E> {
  if (outside === undefined) {
    return Effect.succeed(false);
  }
  const since = Date.parse(outside.at);
  const after = acts.filter(({ at }) => at >= since);
  return Effect.map(
    Effect.forEach(after, ({ run }) => began(run)),
    (begun: readonly (string | undefined)[]) => begun.includes(outside.id),
  );
}
