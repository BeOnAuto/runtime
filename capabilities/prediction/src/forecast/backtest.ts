import { isObserved, observedAt, sumWhollyObserved, type History } from './history.ts';
import { stepsUpTo, type Asked, type Method, type TotalAsked } from './methods.ts';

export interface Backtest {
  readonly origins: number;
  readonly misses: readonly (readonly number[])[];
}

interface Ahead {
  readonly origin: number;
  readonly ahead: number;
}

interface Reach {
  readonly slots: number;
  readonly originsOf: (history: History, needs: number) => readonly Ahead[];
  readonly truthsAfter: (history: History, at: Ahead) => readonly (number | null)[];
}

interface Pair {
  readonly forecasts: readonly number[];
  readonly truths: readonly (number | null)[];
}

const leastMisses = 3;

function stepsReach(steps: number): Reach {
  return {
    slots: steps,
    originsOf: ({ first, origin }, needs) => {
      const earliest = first + needs - 1;
      return Array.from({ length: Math.max(0, origin - steps - earliest + 1) }, (_, at) => ({
        origin: earliest + at,
        ahead: steps,
      }));
    },
    truthsAfter: (history, { origin }) => stepsUpTo(steps).map((step) => observedAt(history, origin + step)),
  };
}

function totalReach({ periodsSoFar, pastTotals }: TotalAsked): Reach {
  const earliestOf = (first: number, needs: number) => first + Math.max(needs, periodsSoFar) - 1;
  return {
    slots: 1,
    originsOf: ({ first }, needs) =>
      pastTotals
        .filter(({ origin }) => origin >= earliestOf(first, needs))
        .map(({ origin, periodsToTheEnd }) => ({ origin, ahead: periodsToTheEnd })),
    truthsAfter: (history, { origin, ahead }) => [sumWhollyObserved(history, origin + 1, origin + ahead)],
  };
}

function reachOf(asked: Asked): Reach {
  return asked.kind === 'steps' ? stepsReach(asked.steps) : totalReach(asked);
}

function missesAt(pairs: readonly Pair[], slot: number): readonly number[] {
  return pairs.flatMap(({ forecasts, truths }) => {
    const truth = truths[slot];
    return isObserved(truth) ? [truth - Number(forecasts[slot])] : [];
  });
}

export function backtestOf(history: History, method: Method, asked: Asked): Backtest {
  const reach = reachOf(asked);
  const origins = reach.originsOf(history, method.needs);
  const pairs = origins.map((at) => ({
    forecasts: method.forecastAt(history, at.origin, at.ahead),
    truths: reach.truthsAfter(history, at),
  }));
  return {
    origins: origins.length,
    misses: Array.from({ length: reach.slots }, (_, slot) => missesAt(pairs, slot)),
  };
}

export function isBacktestedEnough({ misses }: Backtest): boolean {
  return misses.every((slot) => slot.length >= leastMisses);
}
