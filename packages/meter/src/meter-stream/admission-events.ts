import { Schema } from 'effect';

import type { Fallback } from '../licensing/signed-answers.ts';
import { dayOf, monthOf } from '../standing/utc-periods.ts';

export const BasisSchema = Schema.Literals(['licensed', 'first_runs', 'free_rate', 'offline']);

export type Basis = typeof BasisSchema.Type;

export const AdmittedSchema = Schema.Struct({ run: Schema.String, until: Schema.String, basis: BasisSchema });

export interface Hold {
  readonly run: string;
  readonly until: string;
}

interface Tally {
  readonly period: string;
  readonly runs: number;
}

export interface Admitted {
  readonly actions: number;
  readonly licensed: number;
  readonly first_runs: number;
  readonly free_day: Tally | undefined;
  readonly free_month: Tally | undefined;
}

export const noneAdmitted: Admitted = {
  actions: 0,
  licensed: 0,
  first_runs: 0,
  free_day: undefined,
  free_month: undefined,
};

function talliedIn(tally: Tally | undefined, period: string): Tally {
  if (tally === undefined || period > tally.period) return { period, runs: 1 };
  return period === tally.period ? { period, runs: tally.runs + 1 } : tally;
}

function countedBy(admitted: Admitted, basis: Basis, at: string): Admitted {
  if (basis === 'licensed') return { ...admitted, licensed: admitted.licensed + 1 };
  if (basis === 'first_runs') return { ...admitted, first_runs: admitted.first_runs + 1 };
  if (basis === 'offline') return admitted;
  return {
    ...admitted,
    free_day: talliedIn(admitted.free_day, dayOf(at)),
    free_month: talliedIn(admitted.free_month, monthOf(at)),
  };
}

export function admittedAfter(admitted: Admitted, basis: Basis, at: string): Admitted {
  return countedBy({ ...admitted, actions: admitted.actions + 1 }, basis, at);
}

export function heldAfter(recent: readonly Hold[], hold: Hold, at: string): readonly Hold[] {
  return [...recent.filter(({ until }) => until > at), hold];
}

export function flooredAt(admitted: Admitted, chargedThrough: number): Admitted {
  return {
    ...admitted,
    actions: Math.max(admitted.actions, chargedThrough),
    licensed: Math.max(admitted.licensed, chargedThrough),
  };
}

function inPeriod(tally: Tally | undefined, period: string): number {
  return tally?.period === period ? tally.runs : 0;
}

export interface FreeRateUse {
  readonly today: number;
  readonly this_month: number;
}

export function freeRateInUse({ free_day: day, free_month: month }: Admitted, at: string): FreeRateUse {
  return { today: inPeriod(day, dayOf(at)), this_month: inPeriod(month, monthOf(at)) };
}

export type FreeRateLimit = 'free_daily_limit' | 'free_month_used';

export function freeRateLimitOf(
  { today, this_month: thisMonth }: FreeRateUse,
  rate: Fallback,
): FreeRateLimit | undefined {
  if (thisMonth >= rate.per_month) return 'free_month_used';
  return today >= rate.per_day ? 'free_daily_limit' : undefined;
}
