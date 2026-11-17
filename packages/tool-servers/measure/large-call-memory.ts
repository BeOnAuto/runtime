import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const sizes = [0, 4, 8, 16, 32, 64];

const leastHeap = 16;

const mostHeap = 2048;

const closeEnough = 4;

const once = new URL('large-call-once.ts', import.meta.url).pathname;

function completesIn(heapMebibytes: number, mebibytes: number): boolean {
  const ran = spawnSync(execPath, [`--max-old-space-size=${heapMebibytes}`, once, String(mebibytes)], {
    stdio: 'ignore',
  });
  return ran.status === 0;
}

function leastHeapOf(mebibytes: number): number {
  let low = leastHeap;
  let high = mostHeap;
  while (high - low > closeEnough) {
    const middle = Math.floor((low + high) / 2);
    if (completesIn(middle, mebibytes)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

const [none = 0, ...measured] = sizes.map((mebibytes) => leastHeapOf(mebibytes));
process.stdout.write(`a call of no size completes in a heap of ${none} MiB\n`);
measured.forEach((heap, index) => {
  const mebibytes = Number(sizes[index + 1]);
  const each = (heap - none) / mebibytes;
  process.stdout.write(
    `a call of ${mebibytes} MiB completes in a heap of ${heap} MiB: ${each.toFixed(2)} MiB of heap for each MiB\n`,
  );
});
