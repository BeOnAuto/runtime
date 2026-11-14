import { mostReactionDepth } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import {
  stepFromACause,
  stepFromARunFact,
  type CallerRule,
  type ChainFact,
  type ChainOrigin,
  type ChainStep,
} from './chain-origin.ts';

export interface ChainReads<E> {
  readonly firstFactOf: (run: string) => Effect.Effect<ChainFact | undefined, E>;
  readonly recordOf: (id: string) => Effect.Effect<ChainFact | undefined, E>;
}

export interface RunOfAChain {
  readonly run: string;
  readonly fact?: ChainFact;
}

export interface ChainOrigins<E> {
  readonly originOf: (asked: RunOfAChain) => Effect.Effect<ChainOrigin, E>;
  readonly reads: () => number;
}

export const mostOriginReads = 2 * (mostReactionDepth + 2);

interface Walker<E> {
  readonly chainReads: ChainReads<E>;
  readonly rule: CallerRule;
  readonly knownOf: (run: string) => ChainOrigin | undefined;
  readonly counted: () => void;
}

interface Trail {
  readonly runs: readonly string[];
  readonly read: readonly string[];
}

interface Walked {
  readonly origin: ChainOrigin;
  readonly runs: readonly string[];
}

interface Reading<E> {
  readonly key: string;
  readonly fact: Effect.Effect<ChainFact | undefined, E>;
  readonly next: (fact: ChainFact) => ChainStep;
}

function readOnce<E>(
  walker: Walker<E>,
  trail: Trail,
  { key, fact: reading, next }: Reading<E>,
): Effect.Effect<Walked, E> {
  if (trail.read.includes(key) || trail.read.length >= mostOriginReads) {
    return Effect.succeed({ origin: 'unknown', runs: trail.runs });
  }
  walker.counted();
  const further: Trail = { ...trail, read: [...trail.read, key] };
  return Effect.flatMap(reading, (fact) =>
    fact === undefined
      ? Effect.succeed<Walked>({ origin: 'unknown', runs: further.runs })
      : walked(walker, further, next(fact)),
  );
}

function walked<E>(walker: Walker<E>, trail: Trail, step: ChainStep): Effect.Effect<Walked, E> {
  if ('origin' in step) {
    return Effect.succeed({ origin: step.origin, runs: trail.runs });
  }
  const { chainReads, rule } = walker;
  if ('record' in step) {
    return readOnce(walker, trail, {
      key: `record ${step.record}`,
      fact: chainReads.recordOf(step.record),
      next: (fact) => stepFromACause(fact, rule),
    });
  }
  const run = step.firstFactOf;
  const known = walker.knownOf(run);
  if (known !== undefined) {
    return Effect.succeed({ origin: known, runs: trail.runs });
  }
  return readOnce(
    walker,
    { ...trail, runs: [...trail.runs, run] },
    { key: `run ${run}`, fact: chainReads.firstFactOf(run), next: (fact) => stepFromARunFact(run, fact, true, rule) },
  );
}

export function chainOriginsOf<E>(chainReads: ChainReads<E>, rule: CallerRule): ChainOrigins<E> {
  const known = new Map<string, ChainOrigin>();
  const counted = { reads: 0 };
  const walker: Walker<E> = {
    chainReads,
    rule,
    knownOf: (run) => known.get(run),
    counted: () => {
      counted.reads += 1;
    },
  };
  const originOf = ({ run, fact }: RunOfAChain): Effect.Effect<ChainOrigin, E> => {
    const first: ChainStep = fact === undefined ? { firstFactOf: run } : stepFromARunFact(run, fact, false, rule);
    return Effect.map(walked(walker, { runs: [run], read: [] }, first), ({ origin, runs }) => {
      if (origin !== 'unknown') {
        for (const visited of runs) {
          known.set(visited, origin);
        }
      }
      return origin;
    });
  };
  return { originOf, reads: () => counted.reads };
}
