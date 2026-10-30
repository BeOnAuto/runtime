import type { Schema } from 'effect';

import { orderPlaced } from '../dataset-testing/orders.ts';
import { closeOf } from '../periods/enclosing.ts';
import { periodOfDay } from '../periods/grains.ts';
import { dailyTotalsWith, dailyVisitsWith } from '../testing/daily-documents.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import type { Sales } from './projected-sales.ts';
import { today } from './suite-clock.ts';

export const visits: Sales = {
  name: 'daily-visits',
  source: dailyVisitsWith(
    ['  unit: visits', '  season: 7\n  unit: visits'],
    ['  target: { as: count }', '  target: { of: /value, as: sum }'],
  ),
  type: 'visit.made',
  base: { north: 10, south: 20 },
  before: 40,
  valueOf: (level, each) => level + (each % 3),
};

export const tenthVisits: Sales = { ...visits, valueOf: (level, each) => level + (each % 3) / 10 };

export const newVisits: Sales = { ...visits, before: 3 };

const windowOfVisits = 24;

export const olderVisits: Sales = {
  ...visits,
  name: 'older-visits',
  valueOf: (level, each) => (each - today >= -windowOfVisits && each - today < 3 - windowOfVisits ? undefined : level),
};

export const seasonlessVisits: Sales = {
  ...visits,
  name: 'seasonless-visits',
  source: dailyVisitsWith(['  target: { as: count }', '  target: { of: /value, as: sum }']),
};

export const gappedVisits: Sales = {
  ...visits,
  name: 'gapped-visits',
  valueOf: (level, each) => (each === today - 2 ? undefined : level + (each % 3)),
};

function meanOn(level: number, each: number): number | null | undefined {
  if (each === today - 2) {
    return undefined;
  }
  if (each === today - 3) {
    return null;
  }
  return level + (each % 3);
}

export const meanVisits: Sales = {
  ...visits,
  name: 'mean-visits',
  source: dailyVisitsWith(['  target: { as: count }', '  target: { of: /value, as: mean }']),
  valueOf: meanOn,
};

export const totals: Sales = {
  name: 'weekly-sales',
  source: dailyTotalsWith(['  target: { of: /amount, as: sum }', '  target: { of: /value, as: sum }']),
  type: 'sale.made',
  base: { north: 10, south: 10 },
  before: 70,
  valueOf: (level, each) => ((each + 3) % 7 < 5 ? level : level + 4),
};

function totalsTo(enclosing: string, window: number): string {
  return dailyTotalsWith(
    [
      'description: Predicts the sales of each store to the end of the week',
      `description: Predicts the sales of each store to the end of the ${enclosing}`,
    ],
    ['  accumulates: week', `  accumulates: ${enclosing}`],
    ['  window: 56', `  window: ${String(window)}`],
  );
}

export const monthlyTotals: Sales = { ...totals, name: 'monthly-sales', source: totalsTo('month', 124), before: 130 };

export const youngMonthlyTotals: Sales = { ...monthlyTotals, name: 'young-monthly-sales', before: 49 };

export const quarterlyTotals: Sales = {
  ...totals,
  name: 'quarterly-sales',
  source: totalsTo('quarter', 368),
  before: 400,
};

const regions = ['north', 'south'];

function weeklyOrdersPlaced(): readonly Schema.JsonObject[] {
  const week = periodOfDay('week', today);
  return regions.flatMap((region) =>
    Array.from({ length: 20 }, (_, at) => week - 20 + at).map((each) =>
      orderPlaced({
        region,
        at: new Date(closeOf('week', each - 1) + 36_000_000).toISOString(),
        total: 10,
      }),
    ),
  );
}

export const orders: Sales = {
  ...visits,
  name: 'weekly-orders',
  source: weeklyOrders,
  events: weeklyOrdersPlaced(),
};
