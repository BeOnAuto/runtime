import { describe, expect, it } from 'vitest';

import type { Predicts } from '../document/prediction-document.ts';
import { periodForm } from '../periods/grains.ts';
import { shadowOrigins, targetsOf } from './shadow-schedule.ts';

const weeksToAQuarter: Predicts = {
  target: 'sales',
  period: 'week',
  horizons: [],
  accumulates: 'quarter',
  unit: 'sales',
  history: 28,
};

function shown(predicts: Predicts, builtAt: string, closes: number) {
  return shadowOrigins(predicts, Date.parse(builtAt), closes).map(({ origin, form, closesAt }) => {
    const [target] = targetsOf(predicts, origin);
    return {
      origin: form,
      closes: new Date(closesAt).toISOString().slice(0, 10),
      target: target?.form,
      weeks: [periodForm('week', Number(target?.first)), periodForm('week', Number(target?.last))],
      targetCloses: new Date(Number(target?.closesAt)).toISOString().slice(0, 10),
    };
  });
}

describe('the shadow of weeks summed to a quarter', () => {
  it('predicts at the last week of each quarter, the week its Thursday falls in, across the turn of 2027', () => {
    expect(shown(weeksToAQuarter, '2026-12-01T12:00:00Z', 2)).toEqual([
      {
        origin: '2026-W53',
        closes: '2027-01-04',
        target: '2027-Q1',
        weeks: ['2027-W01', '2027-W12'],
        targetCloses: '2027-03-29',
      },
      {
        origin: '2027-W12',
        closes: '2027-03-29',
        target: '2027-Q2',
        weeks: ['2027-W13', '2027-W25'],
        targetCloses: '2027-06-28',
      },
    ]);
  });

  it('predicts a year from its last week, the week of its last Thursday', () => {
    expect(shown({ ...weeksToAQuarter, accumulates: 'year' }, '2026-06-01T12:00:00Z', 1)).toEqual([
      {
        origin: '2026-W53',
        closes: '2027-01-04',
        target: '2027',
        weeks: ['2027-W01', '2027-W52'],
        targetCloses: '2028-01-03',
      },
    ]);
  });
});
