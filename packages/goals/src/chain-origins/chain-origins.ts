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

export interface OutsideEvent {
  readonly id: string;
  readonly at: string;
}

interface ChainBegun {
  readonly origin: ChainOrigin;
  readonly outside?: OutsideEvent;
}

interface ChainWalked extends ChainBegun {
  readonly runs: readonly string[];
}

export interface ChainOrigins<E> {
  readonly originOf: (asked: RunOfAChain) => Effect.Effect<ChainOrigin, E>;
  readonly chainOf: (asked: RunOfAChain) => Effect.Effect<ChainWalked, E>;
  readonly reads: () => number;
}

export const mostOriginReads = 2 * (mostReactionDepth + 2);

interface Walker<E> {
  readonly chainReads: ChainReads<E>;
  readonly rule: CallerRule;
  readonly knownOf: (run: string) => ChainBegun | undefined;
  readonly counted: () => void;
}

interface Trail {
  readonly runs: readonly string[];
  readonly read: readonly string[];
}

interface Reading<E> {
  readonly key: string;
  readonly fact: Effect.Effect<ChainFact | undefined, E>;
  readonly next: (fact: ChainFact) => ChainStep;
  readonly outside?: string;
}

function readOnce<E>(
  walker: Walker<E>,
  trail: Trail,
  { key, fact: reading, next, outside }: Reading<E>,
): Effect.Effect<ChainWalked, E> {
  if (trail.read.includes(key) || trail.read.length >= mostOriginReads) {
    return Effect.succeed({ origin: 'unknown', runs: trail.runs });
  }
  walker.counted();
  const further: Trail = { ...trail, read: [...trail.read, key] };
  return Effect.flatMap(reading, (fact) => {
    if (fact === undefined) {
      return Effect.succeed<ChainWalked>({ origin: 'unknown', runs: further.runs });
    }
    const step = next(fact);
    return 'origin' in step && outside !== undefined
      ? Effect.succeed<ChainWalked>({ ...step, outside: { id: outside, at: fact.context.at }, runs: further.runs })
      : walked(walker, further, step);
  });
}

function walked<E>(walker: Walker<E>, trail: Trail, step: ChainStep): Effect.Effect<ChainWalked, E> {
  if ('origin' in step) {
    return Effect.succeed({ origin: step.origin, runs: trail.runs });
  }
  const { chainReads, rule } = walker;
  if ('record' in step) {
    return readOnce(walker, trail, {
      key: `record ${step.record}`,
      fact: chainReads.recordOf(step.record),
      next: (fact) => stepFromACause(fact, rule),
      outside: step.record,
    });
  }
  const run = step.firstFactOf;
  const known = walker.knownOf(run);
  if (known !== undefined) {
    return Effect.succeed({ ...known, runs: trail.runs });
  }
  return readOnce(
    walker,
    { ...trail, runs: [...trail.runs, run] },
    { key: `run ${run}`, fact: chainReads.firstFactOf(run), next: (fact) => stepFromARunFact(run, fact, true, rule) },
  );
}

export function chainOriginsOf<E>(chainReads: ChainReads<E>, rule: CallerRule): ChainOrigins<E> {
  const known = new Map<string, ChainBegun>();
  const counted = { reads: 0 };
  const walker: Walker<E> = {
    chainReads,
    rule,
    knownOf: (run) => known.get(run),
    counted: () => {
      counted.reads += 1;
    },
  };
  const chainOf = ({ run, fact }: RunOfAChain): Effect.Effect<ChainWalked, E> => {
    const first: ChainStep = fact === undefined ? { firstFactOf: run } : stepFromARunFact(run, fact, false, rule);
    return Effect.map(walked(walker, { runs: [run], read: [] }, first), (chain) => {
      if (chain.origin !== 'unknown') {
        for (const visited of chain.runs) {
          known.set(visited, chain);
        }
      }
      return chain;
    });
  };
  const originOf = (asked: RunOfAChain) => Effect.map(chainOf(asked), ({ origin }) => origin);
  return { originOf, chainOf, reads: () => counted.reads };
}
