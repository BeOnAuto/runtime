import { overviewTitled } from '@on.auto/definitions/testing';
import type { ProjectedFolders } from '@on.auto/workflow-host/testing';
import { Result } from 'effect';

import { datasetDetailsOf } from '../src/capability/prediction-definitions.ts';
import { parsePredictionDocument } from '../src/document/document-parsing.ts';
import type { PredictionFunctionDefinitionDocument } from '../src/document/prediction-document.ts';
import { weeklyOrdersWith } from '../src/testing/weekly-orders.ts';

export const alpha = { org: 'acme', playbook: 'alpha' };

export const alphaKey = 'playbook/acme/alpha/';

export const seriesMeasured = 1000;

const firstDay = Date.UTC(2026, 0, 1);

const day = 86_400_000;

export interface MeasuredFunction {
  readonly name: string;
  readonly source: string;
  readonly document: PredictionFunctionDefinitionDocument;
}

const dailyLines: readonly (readonly [string, string])[] = [
  ['  period: week', '  period: day'],
  ['  season: 52', ''],
  ['  horizons: [1, 4]', '  horizons: [1, 7]'],
  ['  window: 156', '  window: 200'],
  ['  holdout: 12', '  holdout: 14'],
];

const testedLine: readonly [string, string] = [
  '    - type: order.placed',
  "    - type: order.placed\n      data: '${ $data.total > 0 }'",
];

function measuredFunction(name: string, source: string): MeasuredFunction {
  return { name, source, document: Result.getOrThrow(parsePredictionDocument(source)) };
}

export const dailyOrders = measuredFunction('daily-orders', weeklyOrdersWith(...dailyLines));

export const testedDailyOrders = measuredFunction('tested-daily-orders', weeklyOrdersWith(...dailyLines, testedLine));

export function buildStartAfter(days: number): number {
  return firstDay + days * day + day / 2;
}

function regionOf(series: number): string {
  return `region-${String(series).padStart(4, '0')}`;
}

function ordersOf(dayIndex: number) {
  const at = new Date(firstDay + dayIndex * day + 36_000_000).toISOString();
  return Array.from({ length: seriesMeasured }, (_, series) => ({
    type: 'event_published',
    data: {
      event: {
        specversion: '1.0',
        id: `order-${dayIndex}-${series}`,
        source: '/shop',
        type: 'order.placed',
        time: at,
        data: {
          region: regionOf(series),
          placed_at: at,
          total: 10 + ((series * 7 + dayIndex * 3) % 90),
          ...(dayIndex % 7 === 0 ? { promotion: series % 2 } : {}),
        },
      },
      filled: [],
    },
  }));
}

export function recordedDays(folders: ProjectedFolders, from: number, days: number): Promise<void> {
  return Array.from({ length: days }, (_, offset) => from + offset).reduce<Promise<void>>(
    (before, dayIndex) =>
      before.then(() =>
        folders.append(`${alphaKey}events/day-${dayIndex}`, ordersOf(dayIndex), {
          by: 'acme-admin',
          at: new Date(firstDay + dayIndex * day + 36_000_000).toISOString(),
        }),
      ),
    Promise.resolve(),
  );
}

export function savedIn(folders: ProjectedFolders, { name, source, document }: MeasuredFunction): Promise<void> {
  return folders.append(
    `${alphaKey}definitions/prediction`,
    [
      {
        type: 'definition_created',
        data: { content: { source, overview: overviewTitled(name), details: datasetDetailsOf(document) } },
      },
    ],
    {
      by: 'acme-admin',
      at: '2026-01-01T00:00:00.000Z',
      definitionType: 'prediction',
      definitionName: name,
      definitionVersion: 1,
    },
  );
}
