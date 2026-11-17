import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const sizes = [0, 16, 128];

const encodings = ['text', 'base64'] as const;

const leastHeap = 16;

const mostHeap = 2048;

const closeEnough = 4;

const once = new URL('asset-call-once.ts', import.meta.url).pathname;

function completesIn(heapMebibytes: number, mebibytes: number, encoding: string): boolean {
  const ran = spawnSync(execPath, [`--max-old-space-size=${heapMebibytes}`, once, String(mebibytes), encoding], {
    stdio: 'ignore',
  });
  return ran.status === 0;
}

function leastHeapOf(mebibytes: number, encoding: string): number {
  let low = leastHeap;
  let high = mostHeap;
  while (high - low > closeEnough) {
    const middle = Math.floor((low + high) / 2);
    if (completesIn(middle, mebibytes, encoding)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

for (const encoding of encodings) {
  for (const mebibytes of sizes) {
    process.stdout.write(
      `an asset of ${mebibytes} MiB sent as ${encoding} completes in a heap of ${leastHeapOf(mebibytes, encoding)} MiB\n`,
    );
  }
}
