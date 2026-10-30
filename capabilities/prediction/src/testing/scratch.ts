import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processPool, type ProcessPool } from '@on.auto/workflow-engine/dsl';
import { afterAll, afterEach } from 'vitest';

const megabyte = 1_048_576;

const pools: ProcessPool[] = [];

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

afterAll(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

export function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-prediction-'));
  directories.push(directory);
  return directory;
}

export function closedAfterTheTest(processes: number, longJobs = Math.max(1, processes - 2)): ProcessPool {
  const pool = processPool({
    processes,
    longJobs,
    memoryBytes: 1280 * megabyte,
    path: process.env['PATH'],
  });
  pools.push(pool);
  return pool;
}
