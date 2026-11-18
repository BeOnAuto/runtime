import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const outputs = [
  { what: 'a text member of 8 MiB, as a computation on Auto Cloud returns at most', mebibytes: 8, shape: 'text' },
  { what: 'a text member of 32 MiB, as a computation on Node at its default', mebibytes: 32, shape: 'text' },
  { what: 'a member of 8 MiB of JSON rows, as a computation on Auto Cloud', mebibytes: 8, shape: 'rows' },
  { what: 'a member of 32 MiB of JSON rows, as a computation on Node at its default', mebibytes: 32, shape: 'rows' },
] as const;

const leastHeap = 8;

const mostHeap = 4096;

const closeEnough = 2;

const once = new URL('kept-output-once.ts', import.meta.url).pathname;

function completesIn(heapMebibytes: number, mebibytes: number, shape: string, keeping: string): boolean {
  const ran = spawnSync(execPath, [`--max-old-space-size=${heapMebibytes}`, once, String(mebibytes), shape, keeping], {
    stdio: 'ignore',
  });
  return ran.status === 0;
}

function leastHeapOf(mebibytes: number, shape: string, keeping: string): number {
  let low = leastHeap;
  let high = mostHeap;
  while (high - low > closeEnough) {
    const middle = Math.floor((low + high) / 2);
    if (completesIn(middle, mebibytes, shape, keeping)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

for (const { what, mebibytes, shape } of outputs) {
  const held = leastHeapOf(mebibytes, shape, 'held');
  const kept = leastHeapOf(mebibytes, shape, 'kept');
  process.stdout.write(`${what}: the output held alone in ${held} MiB of heap, and kept in ${kept} MiB\n`);
}
