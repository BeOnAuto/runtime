import type { ForecastQuestion } from '../forecast/ladder.ts';

const daysInAWeek = 7;

const weeksBeforeTheHistory = 4;

export function stepsAhead(steps: number): ForecastQuestion['asked'] {
  return { kind: 'steps', steps };
}

export function theRestOfTheWeek(observed: readonly unknown[], periodsSoFar = 3): ForecastQuestion['asked'] {
  const origin = observed.length - 1;
  const periodsToTheEnd = daysInAWeek - periodsSoFar;
  const weeks = Math.floor((origin + weeksBeforeTheHistory * daysInAWeek) / daysInAWeek);
  return {
    kind: 'total',
    periodsToTheEnd,
    periodsSoFar,
    pastTotals: Array.from({ length: weeks }, (_, at) => ({
      origin: origin - (at + 1) * daysInAWeek,
      periodsToTheEnd,
    })),
  };
}
