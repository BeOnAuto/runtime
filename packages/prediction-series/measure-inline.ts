import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FunctionShape } from '@on.auto/prediction-contract';

import { defaultModel, fitModels } from './src/recipes/series-models.ts';

const capabilityMeasures = fileURLToPath(new URL('../../capabilities/prediction/measure-models.ts', import.meta.url));

const models = fileURLToPath(new URL('./src/recipes/series-models.ts', import.meta.url));

const mebibyte = 1_048_576;

const seriesMeasured = 1000;

const trainingDays = 192;

const firstDay = Date.UTC(2026, 2, 1) / 86_400_000;

const daily: FunctionShape = {
  fed: { features: 0, given: 0, horizon: 2, totals: false },
  grain: 'day',
  season: 7,
  accumulates: null,
  holdout: 8,
};

function trainingSeries(): readonly Float64Array[] {
  return Array.from({ length: seriesMeasured }, (_, series) =>
    Float64Array.from({ length: trainingDays }, (_day, day) => 10 + ((day + series) % 7)),
  );
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

const series = trainingSeries();
const heapBefore = process.memoryUsage().heapUsed;
const fitStarted = performance.now();
const fitted = await fitModels(daily, { first: firstDay, series });
const fitMs = performance.now() - fitStarted;
const heapAfter = process.memoryUsage().heapUsed;
const decoder = new TextDecoder();
const recipes = fitted.map(({ bytes }) => decoder.decode(bytes));
const linear = recipes.find((recipe) => recipe.includes('"linear"')) ?? '';
const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-series-models-'));
const defaulted = join(directory, 'default.series');
const largest = join(directory, 'linear.series');
try {
  writeFileSync(defaulted, defaultModel(daily).bytes);
  writeFileSync(largest, linear);
  write(
    `the recipes fitted from ${seriesMeasured * trainingDays} training rows of ${seriesMeasured} series: ${String(fitted.length)} in ${fitMs.toFixed(0)} ms, the heap ${((heapAfter - heapBefore) / mebibyte).toFixed(1)} MiB larger after it, the largest recipe ${String(Math.max(...recipes.map((recipe) => recipe.length)))} bytes`,
  );
  execFileSync(process.execPath, [capabilityMeasures, models, defaulted, largest, 'inline'], { stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
