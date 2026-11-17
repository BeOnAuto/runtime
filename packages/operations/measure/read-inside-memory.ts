import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const readers = [
  { reader: 'a reasoning prompt, 400,000 characters', mebibytes: 0.4, content: 'text' },
  { reader: 'a call on Auto Cloud, 8 MiB', mebibytes: 8, content: 'text' },
  { reader: 'a call on a runtime of its own, 16 MiB by default', mebibytes: 16, content: 'text' },
  { reader: 'a call at the most a runtime of its own may set, 128 MiB', mebibytes: 128, content: 'text' },
  { reader: 'a computation on Auto Cloud, 8 MiB', mebibytes: 8, content: 'json' },
  { reader: 'a computation on Node at its default, 32 MiB', mebibytes: 32, content: 'json' },
  { reader: 'nothing read, as a baseline', mebibytes: 0, content: 'text' },
] as const;

const leastHeap = 8;

const mostHeap = 4096;

const closeEnough = 2;

const once = new URL('read-inside-once.ts', import.meta.url).pathname;

function completesIn(heapMebibytes: number, mebibytes: number, content: string): boolean {
  const ran = spawnSync(execPath, [`--max-old-space-size=${heapMebibytes}`, once, String(mebibytes), content], {
    stdio: 'ignore',
  });
  return ran.status === 0;
}

function leastHeapOf(mebibytes: number, content: string): number {
  let low = leastHeap;
  let high = mostHeap;
  while (high - low > closeEnough) {
    const middle = Math.floor((low + high) / 2);
    if (completesIn(middle, mebibytes, content)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

for (const { reader, mebibytes, content } of readers) {
  process.stdout.write(
    `${reader}: a kept ${content} of ${mebibytes} MiB is read inside in a heap of ${leastHeapOf(mebibytes, content)} MiB\n`,
  );
}
