import { Effect } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import type { ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { programPool } from '../program-pool/program-pool.ts';
import { runMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import * as programWorkerModule from '../workers/program-worker.ts';
import { countingOnTheLoop } from './counting-workers.ts';
import { moduleOfSource } from './source-modules.ts';
import { testPoolSettings } from './test-pools.ts';
import { threadPool } from './thread-pool.ts';

function request(
  body: string,
  input: ProgramRequest['arguments'][number] = null,
  more: Partial<ProgramRequest> = {},
): ProgramRequest {
  return {
    source: `export default function (input) {\n  ${body}\n}`,
    entry: 'default',
    arguments: [input],
    moment: Date.UTC(2026, 3, 1),
    budget: 20_000,
    memoryBytes: runMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs: 10_000,
    mostOutputBytes: 1_048_576,
    ...more,
  };
}

const onTheThread = threadPool(testPoolSettings(2));

const pools: readonly (readonly [string, ProgramPool])[] = [
  ['on the thread of the test', onTheThread],
  ['on worker threads', programPool(testPoolSettings(2))],
];

afterAll(async () => {
  await Promise.all(pools.map(([, pool]) => pool.close()));
});

describe.each(pools)('a program pool %s', (_where, pool) => {
  it('runs on the worker module of the pool, though the test imported that module already', async () => {
    expect(Object.keys(programWorkerModule)).toEqual([]);
    expect(await pool.run(request('return input + 1;', 1))).toMatchObject({ ran: 'answered', output: 2 });
  });

  it('starts a thread for another module while every thread it may keep idles', async () => {
    await Promise.all([pool.run(request('return 1;')), pool.run(request('return 2;'))]);

    expect(await pool.run(request('.', null, { source: 'count', worker: countingOnTheLoop }))).toMatchObject({
      ran: 'answered',
      output: { jobs: 1 },
    });
  });

  it('runs a program on its input, and ends one that raises or works too long as a worker would', async () => {
    const outcomes = [
      await pool.run(request('return { doubled: input * 2 };', 21)),
      await pool.run(request('throw new Error("stop");')),
      await pool.run(request('for (;;) {}', null, { budget: 50 })),
    ];

    expect(outcomes).toMatchObject([
      { ran: 'answered', output: { doubled: 42 } },
      { ran: 'raised', issue: { detail: 'Error: stop' } },
      { ran: 'exhausted', limit: 'work' },
    ]);
  });

  it('evaluates an expression on its machine sandbox', async () => {
    const { machine } = pool.evaluations;
    await Effect.runPromise(machine.reserve);
    const unit = machine.unit();
    const evaluated = unit.evaluate(
      '1 + 1',
      {},
      { budget: 250, deadlineAt: machine.clock() + 10_000, moment: Date.UTC(2026, 3, 1) },
    );
    unit.close();

    expect(evaluated).toMatchObject({ ran: 'answered', text: '2' });
  });
});

describe('a program pool on the thread of the test that closes while it answers a run', () => {
  it('answers the run, and lets its thread go once though it lets go of it twice', async () => {
    const closing = threadPool(testPoolSettings(1));
    const loaded = Promise.withResolvers<void>();
    Reflect.set(globalThis, 'workerLoadedOnTheThread', loaded.resolve);
    const worker = moduleOfSource(
      [
        `import { serveJobs } from '${new URL('../program-pool/job-loop.ts', import.meta.url).href}';`,
        'globalThis.workerLoadedOnTheThread();',
        "serveJobs({ program: () => ({ ran: 'answered', output: '3', bytes: 1, work: 0 }) });",
      ].join('\n'),
    );

    const running = closing.run(request('.', null, { worker }));
    await loaded.promise;
    await closing.close();

    expect(await running).toMatchObject({ ran: 'answered', output: 3 });
    expect(await closing.run(request('return 4;'))).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});

describe('a program pool on the thread of the test given a request it cannot start', () => {
  it('answers a cancelled request as cancelled, sending it nowhere', async () => {
    await expect(onTheThread.run(request('return 1;'), AbortSignal.abort())).resolves.toMatchObject({
      ran: 'stopped',
    });
  });

  it('answers as crashed a run whose worker module serves no jobs, and runs a worker module of its own given as data', async () => {
    const answering = moduleOfSource(
      [
        `import { serveJobs } from '${new URL('../program-pool/job-loop.ts', import.meta.url).href}';`,
        "serveJobs({ program: () => ({ ran: 'answered', output: '7', bytes: 1, work: 0 }) });",
      ].join('\n'),
    );

    expect([
      await onTheThread.run(request('return 1;', null, { worker: moduleOfSource('export const nothing = 1;') })),
      await onTheThread.run(request('return 1;', null, { worker: answering })),
    ]).toMatchObject([
      { ran: 'crashed', detail: 'The worker failed: Error: The module serves no jobs' },
      { ran: 'answered', output: 7 },
    ]);
  });
});
