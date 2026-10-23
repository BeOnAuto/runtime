import { programPool, workerStackMegabytes, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import { computationBounds, mebibytes } from '../src/run/run-bounds.ts';
import { formatted, functionOf, handed, inTurn, poolOfOne, request } from './common.ts';

const blocking = new URL(`data:text/javascript,${encodeURIComponent('while (true) {}')}`);

const recursion = functionOf('const down = (left) => (left === 0 ? 0 : down(left - 1));\n  return down(input);');

interface Bomb {
  readonly name: string;
  readonly body: string;
}

const bombs: readonly Bomb[] = [
  {
    name: 'strings of a megabyte',
    body: 'const kept = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);',
  },
  {
    name: 'small objects',
    body: 'const kept = [];\n  for (let index = 0; ; index++) kept.push({ index, text: "w" + index });',
  },
];

async function termination(): Promise<string> {
  const pool = programPool({
    handed,
    instances: 'fresh',
    workers: 1,
    heapMegabytes: computationBounds.heapMegabytes,
    worker: blocking,
  });
  const ended = await pool.run(request(functionOf('return input;'), 1, 500));
  await pool.close();
  return `a worker that never answers, under a deadline of 500 ms: ended ${ended.ran}, after ${formatted(ended.milliseconds, 1)} ms`;
}

async function deepestBetween(pool: ProgramPool, low: number, high: number): Promise<number> {
  if (low >= high) {
    return low;
  }
  const middle = Math.ceil((low + high) / 2);
  const ended = await pool.run(request(recursion, middle));
  return ended.ran === 'answered' ? deepestBetween(pool, middle, high) : deepestBetween(pool, low, middle - 1);
}

async function bombed(pool: ProgramPool, { name, body }: Bomb): Promise<string> {
  const twice = await inTurn([0, 1], async () => {
    const ended = await pool.run(request(functionOf(body), null));
    return ended.ran === 'exhausted'
      ? `${ended.limit} after ${ended.work} checkpoints, ${formatted(ended.milliseconds)} ms`
      : ended.ran;
  });
  return `  ${name}: ${twice.join('; ')}`;
}

export async function workersMeasured(): Promise<readonly string[]> {
  const pool = poolOfOne();
  const lines = [
    await termination(),
    `the deepest recursion of a function that calls itself once, in the stack of ${computationBounds.stackBytes / mebibytes} MiB of a run, in a worker of ${workerStackMegabytes} MiB: ${formatted(await deepestBetween(pool, 1, 60_000))} calls`,
    `programs that keep allocating, twice each, under the ${computationBounds.memoryBytes / mebibytes} MiB of a run's sandbox:`,
  ];
  const bombedLines = await inTurn(bombs, (bomb) => bombed(pool, bomb));
  await pool.close();
  return [...lines, ...bombedLines];
}
