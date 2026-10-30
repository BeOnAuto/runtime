import { documentWith } from './weekly-orders.ts';

const dailyVisitsLines: readonly string[] = [
  '---',
  'description: Predicts the visits of each store one and two days ahead',
  'predicts:',
  '  target: visits',
  '  period: day',
  '  horizons: [1, 2]',
  '  unit: visits',
  'data:',
  '  events:',
  '    - type: visit.made',
  '  time: event',
  '  series: /store',
  '  target: { as: count }',
  '  window: 24',
  '---',
];

const dailyTotalsLines: readonly string[] = [
  '---',
  'description: Predicts the sales of each store to the end of the week',
  'predicts:',
  '  target: sales',
  '  period: day',
  '  season: 7',
  '  accumulates: week',
  '  unit: sales',
  'data:',
  '  events:',
  '    - type: sale.made',
  '  time: event',
  '  series: /store',
  '  target: { of: /amount, as: sum }',
  '  window: 56',
  '---',
];

export const dailyVisits = dailyVisitsLines.join('\n');

export const dailyTotals = dailyTotalsLines.join('\n');

export function dailyVisitsWith(...replaced: readonly (readonly [string, string])[]): string {
  return documentWith(dailyVisitsLines, ...replaced);
}

export function dailyTotalsWith(...replaced: readonly (readonly [string, string])[]): string {
  return documentWith(dailyTotalsLines, ...replaced);
}
