import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { seriesRowsIn } from '../src/files/series-rows.ts';
import { importedRuntime } from '../src/model-jobs/runtime-modules.ts';
import { walked } from '../src/model-jobs/walk-job.ts';
import { threadsOf } from '../src/model-processes/model-processes.ts';
import { daysMeasured, widestFeatures } from './model-files.ts';

const serverProcesses = 4;

const [module = '', model = '', rows = ''] = process.argv.slice(2);
const runtime = pathToFileURL(resolve(module)).href;
const threads = threadsOf(serverProcesses);
const before = process.memoryUsage().rss;
const loaded = await (await importedRuntime(runtime))(model, threads);
const started = performance.now();
const parsed = await seriesRowsIn(rows, { features: widestFeatures });
const walk = {
  runtime,
  model,
  threads,
  rows,
  window: daysMeasured,
  holdout: 8,
  steps: 2,
  features: 0,
  given: [],
  remaining: null,
};
const answer = await walked(loaded, walk, parsed);
const walkMs = performance.now() - started;
const after = process.memoryUsage().rss;
const series = 'series' in answer ? answer.series.length : 0;
process.stdout.write(
  `${JSON.stringify({ threads, series, walkMs, before, after, peak: process.resourceUsage().maxRSS * 1024 })}\n`,
);
