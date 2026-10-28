import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { measuredFiles, seriesMeasured, daysMeasured } from './measure/model-files.ts';
import { baselineCheckTimings, modelTimings, questionTimings } from './measure/model-timings.ts';

const mebibyte = 1_048_576;

const MemorySchema = Schema.fromJsonString(
  Schema.Struct({
    threads: Schema.Number,
    series: Schema.Number,
    walkMs: Schema.Number,
    before: Schema.Number,
    after: Schema.Number,
    peak: Schema.Number,
  }),
);

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function ms(milliseconds: number): string {
  return `${milliseconds.toFixed(0)} ms`;
}

function mib(bytes: number): string {
  return `${(bytes / mebibyte).toFixed(0)} MiB`;
}

const [module = '', mean = '', large = '', bound = 'process'] = process.argv.slice(2);
const kind = bound === 'inline' ? 'inline' : 'process';
const files = measuredFiles({ module, mean, large, kind });
try {
  write(
    `Node ${process.version}, ${cpus().length} cores, the runtime bound ${kind === 'inline' ? 'inline, in this process' : 'in model processes'}`,
  );
  const timed = await modelTimings(files);
  write(`a model process started cold, the model loaded and checked: ${ms(timed.coldCheckMs)}`);
  write(`a question on a process that has not loaded the model: ${ms(timed.coldRunMs)}`);
  write(`a question on the process that holds the model: ${ms(timed.warmRunMs)}`);
  write(
    `eight walks over ${seriesMeasured * daysMeasured} rows of ${seriesMeasured} series, 8 origins and 2 steps each: ${timed.walksMs.map((each) => ms(each)).join(', ')}`,
  );
  write(`the scores, the baseline and the bootstrap of one walk computed by the server: ${ms(timed.verdictMs)}`);
  write(`the shadow's walk of one version at one close over ${seriesMeasured} series: ${ms(timed.shadowWalkMs)}`);
  write(`the shadow's grade of one period over ${seriesMeasured} series: ${ms(timed.gradeMs)}`);
  execFileSync(process.execPath, [fileURLToPath(new URL('./measure/large-rows.ts', import.meta.url)), files.widest]);
  const largeBytes = statSync(files.large).size;
  const widestBytes = statSync(files.widest).size;
  const memory = Schema.decodeUnknownSync(MemorySchema)(
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./measure/session-memory.ts', import.meta.url)), module, files.large, files.widest, kind],
      { encoding: 'utf8' },
    ),
  );
  write(
    `a session of a ${mib(largeBytes)} model on ${memory.threads} threads walking ${memory.series} series of ${mib(widestBytes)} of rows in ${ms(memory.walkMs)}: ${mib(memory.before)} resident before it, ${mib(memory.after)} after, ${mib(memory.peak)} at the peak`,
  );
  const checked = await baselineCheckTimings(files);
  write(
    `the check of two baselines at a build's start over ${mib(widestBytes)} of rows, in a model process: ${ms(checked.checkMs)}, ${checked.perfect ?? 'none'} perfect, the server's heap ${mib(checked.heapGrowth)} larger after it`,
  );
  const asked = await questionTimings(files);
  write(
    `a question over an upload of ${mib(widestBytes)}: the window read by a model process in ${ms(asked.windowMs)}, the question answered in ${ms(asked.runMs)}, the server's heap ${mib(asked.heapGrowth)} larger after it`,
  );
} finally {
  rmSync(files.directory, { recursive: true, force: true });
}
