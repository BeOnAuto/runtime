import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModelRuntime } from '@on.auto/prediction-contract';

export const seriesMeasured = 1000;

export const daysMeasured = 200;

const firstOfTheMeasures = Date.UTC(2026, 2, 1);

export const firstDayMeasured = firstOfTheMeasures / 86_400_000;

export interface MeasuredFiles {
  readonly directory: string;
  readonly runtime: ModelRuntime;
  readonly mean: string;
  readonly large: string;
  readonly rows: string;
  readonly widest: string;
}

function rowsText(): string {
  const records = ['series,period,visits'];
  const first = firstOfTheMeasures;
  for (let series = 0; series < seriesMeasured; series += 1) {
    const name = `store-${String(series).padStart(4, '0')}`;
    for (let day = 0; day < daysMeasured; day += 1) {
      records.push(
        `${name},${new Date(first + day * 86_400_000).toISOString().slice(0, 10)},${10 + ((day + series) % 7)}`,
      );
    }
  }
  return `${records.join('\r\n')}\r\n`;
}

export const widestFeatures = 40;

export function widestRowsText(): string {
  const features = Array.from({ length: widestFeatures }, (_, feature) => `feature_${feature}`);
  const records = [['series', 'period', 'visits', ...features].join(',')];
  const first = firstOfTheMeasures;
  for (let series = 0; series < seriesMeasured; series += 1) {
    const name = `store-${String(series).padStart(4, '0')}`;
    for (let day = 0; day < daysMeasured; day += 1) {
      const period = new Date(first + day * 86_400_000).toISOString().slice(0, 10);
      const values = features.map((_, feature) => (1000 + feature * 1.25 + ((day + series) % 7)).toFixed(3));
      records.push([name, period, String(10 + ((day + series) % 7)), ...values].join(','));
    }
  }
  return `${records.join('\r\n')}\r\n`;
}

type MeasuredBinding = ModelRuntime['binding']['kind'];

function measuredRuntime(module: string, kind: MeasuredBinding): ModelRuntime {
  const address = pathToFileURL(resolve(module));
  return {
    name: 'measured-runtime',
    version: '0.0.0',
    formats: ['measured'],
    capabilities: { features: true, given: true, totals: true },
    binding: { kind, module: () => address },
  };
}

export interface Measuring {
  readonly module: string;
  readonly mean: string;
  readonly large: string;
  readonly kind: MeasuredBinding;
}

export function measuredFiles({ module, mean, large, kind }: Measuring): MeasuredFiles {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-prediction-models-'));
  const files = { rows: join(directory, 'scoring.csv'), widest: join(directory, 'widest.csv') };
  writeFileSync(files.rows, rowsText());
  return { directory, runtime: measuredRuntime(module, kind), mean, large, ...files };
}
