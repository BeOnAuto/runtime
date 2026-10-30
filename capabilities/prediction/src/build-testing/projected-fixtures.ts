import type { Schema } from 'effect';

import { orderPlaced } from '../dataset-testing/orders.ts';
import { closeOf } from '../periods/enclosing.ts';
import { periodOfDay } from '../periods/grains.ts';
import { dailyTotalsWith, dailyVisitsWith } from '../testing/daily-documents.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';
import type { Sales } from './projected-visits.ts';
import { today } from './suite-clock.ts';

export const visits: Sales = {
  name: 'daily-visits',
  source: dailyVisitsWith(
    ['  unit: visits', '  season: 7\n  unit: visits'],
    ['  target: { as: count }', '  target: { of: /value, as: sum }'],
    ['  holdout: 8', '  holdout: 8\n  baselines: [seasonal-naive]\n  shadow_periods: 2'],
  ),
  type: 'visit.made',
  base: { north: 10, south: 20 },
  before: 40,
  after: 5,
  valueOf: (level, each) => level + (each % 3),
};

export const tenthVisits: Sales = { ...visits, valueOf: (level, each) => level + (each % 3) / 10 };

export const totals: Sales = {
  name: 'weekly-sales',
  source: dailyTotalsWith(
    ['  target: { of: /amount, as: sum }', '  target: { of: /value, as: sum }'],
    ['  holdout: 14', '  holdout: 14\n  baselines: [persistence]\n  coverage_floor: 0.6\n  shadow_periods: 1'],
  ),
  type: 'sale.made',
  base: { north: 10, south: 10 },
  before: 70,
  after: 16,
  valueOf: (level, each) => ((each + 3) % 7 < 5 ? level : level + 4),
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
        ...(each % 2 === 0 ? { promotion: 1 } : {}),
      }),
    ),
  );
}

export const orders: Sales = {
  ...visits,
  name: 'weekly-orders',
  source: weeklyOrdersWith(['  holdout: 12', '  holdout: 12\n  baselines: [seasonal-naive]']),
  events: weeklyOrdersPlaced(),
};

function quietAfterToday(level: number, each: number): number | undefined {
  return level === 40 && each >= today ? undefined : level + (each % 3);
}

export const quietVisits: Sales = {
  ...visits,
  base: { north: 10, south: 20, west: 40 },
  valueOf: quietAfterToday,
};

function gappyValue(level: number, each: number): number | null | undefined {
  if (level === 50) {
    return level;
  }
  if (level < 30) {
    return level + (each % 3);
  }
  if (each >= today) {
    return null;
  }
  return each % 2 === 0 ? level : undefined;
}

export const gappyVisits: Sales = {
  ...visits,
  source: visits.source.replace('  target: { of: /value, as: sum }', '  target: { of: /value, as: last }'),
  base: { north: 10, south: 20, east: 30, flat: 50 },
  valueOf: gappyValue,
};
