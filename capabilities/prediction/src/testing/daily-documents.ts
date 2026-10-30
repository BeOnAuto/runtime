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
  'evaluation:',
  '  holdout: 8',
  '  activate: automatic',
  'source:',
  '  expires: P1D',
  '---',
  'Fit a model of the daily {{ function.target }} of each of {{ dataset.series }} stores.',
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
  'evaluation:',
  '  holdout: 14',
  '  activate: automatic',
  'source:',
  '  expires: P1D',
  '---',
  'Fit a model of the {{ function.target }} of each store to the end of each {{ dataset.accumulates }}.',
];

export const dailyVisits = dailyVisitsLines.join('\n');

export const dailyTotals = dailyTotalsLines.join('\n');

export function dailyVisitsWith(...replaced: readonly (readonly [string, string])[]): string {
  return documentWith(dailyVisitsLines, ...replaced);
}

export function dailyTotalsWith(...replaced: readonly (readonly [string, string])[]): string {
  return documentWith(dailyTotalsLines, ...replaced);
}

const projectionLines: readonly (readonly [string, string])[] = [
  ['  events:', ''],
  ['  time: event', ''],
  ['  series: /store', ''],
];

export function uploadedDailyVisits(sha256: string): string {
  return dailyVisitsWith(
    ...projectionLines,
    ['    - type: visit.made', `  dataset: ${sha256}`],
    ['  target: { as: count }', ''],
  );
}

export function trainerlessDailyVisits(sha256: string): string {
  return dailyVisitsWith(
    ...projectionLines,
    ['    - type: visit.made', `  dataset: ${sha256}`],
    ['  target: { as: count }', ''],
    ['source:', ''],
    ['  expires: P1D', ''],
  );
}

export function uploadedDailyTotals(sha256: string): string {
  return dailyTotalsWith(
    ...projectionLines,
    ['    - type: sale.made', `  dataset: ${sha256}`],
    ['  target: { of: /amount, as: sum }', ''],
  );
}
