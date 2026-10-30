import { lastObservedAt, meanObservedWithin, observedAt, sumOf, type History } from './history.ts';

export interface PastTotal {
  readonly origin: number;
  readonly periodsToTheEnd: number;
}

export type Asked =
  | { readonly kind: 'steps'; readonly steps: number }
  | {
      readonly kind: 'total';
      readonly periodsToTheEnd: number;
      readonly periodsSoFar: number;
      readonly pastTotals: readonly PastTotal[];
    };

export type TotalAsked = Extract<Asked, { readonly kind: 'total' }>;

export const methodNames = ['level-adjusted-seasonal-naive', 'seasonal-naive', 'persistence', 'run-rate'] as const;

export type MethodName = (typeof methodNames)[number];

export interface Method {
  readonly name: MethodName;
  readonly season: number | null;
  readonly k: number | null;
  readonly needs: number;
  readonly forecastAt: (history: History, origin: number, ahead: number) => readonly number[];
}

type StepAt = (step: number) => number;

interface SeasonalRung {
  readonly name: Extract<MethodName, 'level-adjusted-seasonal-naive' | 'seasonal-naive'>;
  readonly season: number;
  readonly k: number | null;
  readonly needs: number;
  readonly stepsFrom: (history: History, origin: number) => StepAt;
}

interface Level {
  readonly season: number;
  readonly k: number;
}

export function aheadOf(asked: Asked): number {
  return asked.kind === 'steps' ? asked.steps : asked.periodsToTheEnd;
}

export function stepsUpTo(horizon: number): readonly number[] {
  return Array.from({ length: horizon }, (_, at) => at + 1);
}

function seasonalLagOf(season: number, step: number): number {
  return season * Math.ceil(step / season);
}

function levelRatioAt(history: History, origin: number, { season, k }: Level): number {
  const recent = meanObservedWithin(history, origin - k + 1, origin);
  const earlier = meanObservedWithin(history, origin - k + 1 - season, origin - season);
  const ratio = recent === null || earlier === null || earlier === 0 ? 1 : recent / earlier;
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : 1;
}

function seasonalStepsFrom(history: History, origin: number, season: number, ratio: number): StepAt {
  const persisting = lastObservedAt(history, origin);
  return (step) => {
    const lag = seasonalLagOf(season, step);
    const seasonal = observedAt(history, origin + step - lag);
    if (seasonal === null) {
      return persisting;
    }
    const levelled = seasonal * ratio ** (lag / season);
    return Number.isFinite(levelled) ? levelled : seasonal;
  };
}

function seasonalRungsOf(season: number, horizon: number): readonly SeasonalRung[] {
  const k = Math.min(horizon, season);
  return [
    {
      name: 'level-adjusted-seasonal-naive',
      season,
      k,
      needs: season + k,
      stepsFrom: (history, origin) =>
        seasonalStepsFrom(history, origin, season, levelRatioAt(history, origin, { season, k })),
    },
    {
      name: 'seasonal-naive',
      season,
      k: null,
      needs: season,
      stepsFrom: (history, origin) => seasonalStepsFrom(history, origin, season, 1),
    },
  ];
}

function seasonalMethodOf({ stepsFrom, ...named }: SeasonalRung, asked: Asked): Method {
  return {
    ...named,
    forecastAt: (history, origin, ahead) => {
      const stepAt = stepsFrom(history, origin);
      const forecasts = stepsUpTo(ahead).map((step) => stepAt(step));
      return asked.kind === 'steps' ? forecasts : [sumOf(forecasts)];
    },
  };
}

export function seasonalMethodsOf(season: number | null, asked: Asked): readonly Method[] {
  return season === null ? [] : seasonalRungsOf(season, aheadOf(asked)).map((rung) => seasonalMethodOf(rung, asked));
}

const persistence: Method = {
  name: 'persistence',
  season: null,
  k: null,
  needs: 1,
  forecastAt: (history, origin, ahead) => {
    const level = lastObservedAt(history, origin);
    return Array.from({ length: ahead }, () => level);
  },
};

function runRateOf({ periodsSoFar }: TotalAsked): Method {
  return {
    name: 'run-rate',
    season: null,
    k: null,
    needs: 1,
    forecastAt: (history, origin, ahead) => {
      const rated = periodsSoFar > 0 ? periodsSoFar : ahead;
      const rate = meanObservedWithin(history, origin - rated + 1, origin) ?? lastObservedAt(history, origin);
      return [rate * ahead];
    },
  };
}

export function lowestMethodOf(asked: Asked): Method {
  return asked.kind === 'steps' ? persistence : runRateOf(asked);
}
