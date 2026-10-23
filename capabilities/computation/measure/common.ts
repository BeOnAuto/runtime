import { handedWorkersWithChecks } from '@on.auto/definitions/check';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { programPool, type Json, type ProgramPool, type ProgramRequest } from '@on.auto/workflow-engine/dsl';

import { computationBounds } from '../src/run/run-bounds.ts';

export const handed = await handedWorkersWithChecks(shippedFilesOnDisk);

export function millisecondsOf(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

export function median(samples: readonly number[]): number {
  return samples.toSorted((first, second) => first - second)[Math.floor(samples.length / 2)] ?? 0;
}

export function formatted(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

export function functionOf(body: string): string {
  return `export default function (input) {\n  ${body}\n}`;
}

export function request(
  source: string,
  input: Json,
  deadlineMs: number = computationBounds.deadlineMs,
): ProgramRequest {
  return {
    source,
    entry: 'default',
    arguments: [input],
    moment: 0,
    budget: computationBounds.budget,
    memoryBytes: computationBounds.memoryBytes,
    stackBytes: computationBounds.stackBytes,
    deadlineMs,
    mostOutputBytes: 1_000_000,
  };
}

export function poolOfOne(): ProgramPool {
  return programPool({ handed, instances: 'fresh', workers: 1, heapMegabytes: computationBounds.heapMegabytes });
}
