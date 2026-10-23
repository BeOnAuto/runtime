import { afterEach, describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import type { PoolSettings, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { nextThreadStarted, threadEnded } from '../pool-testing/threads-alive.ts';
import { isWatched, longerThanTheTestMs, until } from '../pool-testing/waiting.ts';
import { runMemoryBytes, unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { programPool } from './program-pool.ts';

const timerSlackMs = 2;

const pools: ProgramPool[] = [];

function workerOf(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

const blocking = workerOf('while (true) {}');

function answeringWith(output: string): URL {
  return workerOf(
    [
      "import { parentPort } from 'node:worker_threads';",
      'parentPort.on("message", ({ job, request }) => {',
      `  const output = JSON.stringify(${output});`,
      "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
      '});',
    ].join('\n'),
  );
}

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(4), ...settings });
  pools.push(pool);
  return pool;
}

function program(body: string): string {
  return `export default function (input) {\n  ${body}\n}`;
}

function request(source: string, input: Json = null, more: Partial<ProgramRequest> = {}): ProgramRequest {
  return {
    source,
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

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

const endings: readonly (readonly [string, string, Partial<ProgramRequest>, Readonly<Record<string, unknown>>])[] = [
  [
    'raises an error',
    program('throw new Error("stop");'),
    {},
    { ran: 'raised', issue: { detail: 'Error: stop', line: 2 } },
  ],
  ['does too much work', program('for (;;) {}'), { budget: 50 }, { ran: 'exhausted', limit: 'work', work: 51 }],
  [
    'uses more memory than its sandbox has',
    program('const kept = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);'),
    { memoryBytes: unitMemoryBytes },
    { ran: 'exhausted', limit: 'memory' },
  ],
  [
    'answers a value too deep',
    program('let value = 0;\n  for (let level = 0; level < 600; level++) value = [value];\n  return value;'),
    {},
    { ran: 'unfit' },
  ],
  ['gives a number JSON cannot carry', program('return 0 / 0;'), {}, { ran: 'unfit' }],
  [
    'exports no function the request names',
    'export function other() {\n  return 1;\n}',
    {},
    { ran: 'refused', issue: { detail: 'The program exports no function default' } },
  ],
  [
    'does not load',
    'export default function (input) {\n  return input +;\n}',
    {},
    { ran: 'refused', issue: { line: 2 } },
  ],
];

describe('a program run in a worker of the pool', () => {
  it('answers its output as JSON with its size and the work it did, and how long the run took', async () => {
    const outcome = await poolOf().run(
      request(program('return input.rows.map((row) => row * 2);'), { rows: [1, 2, 3] }),
    );

    expect(outcome).toMatchObject({ ran: 'answered', output: [2, 4, 6], bytes: 7, work: 0 });
    expect(outcome.milliseconds).toBeGreaterThan(0);
  });

  it('calls the function its entry names with the arguments it is given, at the moment it is given', async () => {
    const answering = 'export function answer(view, input) {\n  return [view + input.add, Date.now()];\n}';

    expect(await poolOf().run(request(answering, null, { entry: 'answer', arguments: [1, { add: 2 }] }))).toMatchObject(
      { ran: 'answered', output: [3, Date.UTC(2026, 3, 1)] },
    );
  });

  it.each(endings)('answers how it ended when it %s', async (_ending, source, more, ended) => {
    expect(await poolOf().run(request(source, null, more))).toMatchObject(ended);
  });
});

describe('a program that would depend on the stack of its worker', () => {
  it('overflows its stack of a fixed size at the same depth every time, which it may catch', async () => {
    const pool = poolOf();
    const deepest = program(
      'let deepest = 0;\n  const down = (depth) => {\n    deepest = depth;\n    return down(depth + 1);\n  };\n  try {\n    down(0);\n  } catch {\n    return deepest;\n  }\n  return -1;',
    );
    const uncaught = program('const down = (depth) => down(depth + 1);\n  return down(0);');

    const first = await pool.run(request(deepest));
    const second = await pool.run(request(deepest));

    expect(first).toEqual({ ...second, milliseconds: first.milliseconds });
    expect([first.ran, typeof Reflect.get(first, 'output')]).toEqual(['answered', 'number']);
    expect(await pool.run(request(uncaught))).toMatchObject({
      ran: 'raised',
      issue: { detail: 'InternalError: stack overflow' },
    });
  });
});

describe('what a worker of the pool refuses', () => {
  it('cuts the text of an error the program raised at 1,024 bytes, so a long one never crosses whole', async () => {
    expect(await poolOf().run(request(program('throw new Error("x".repeat(30000000));')))).toMatchObject({
      ran: 'raised',
      issue: { detail: `Error: ${'x'.repeat(1017)}…` },
    });
  });

  it('answers that an output is larger than it may give, without the output, in characters and in bytes', async () => {
    const pool = poolOf();
    const outcome = await pool.run(request(program('return "x".repeat(100);'), null, { mostOutputBytes: 50 }));

    expect(outcome).toMatchObject({ ran: 'oversized' });
    expect(outcome).not.toHaveProperty('output');
    expect(await pool.run(request(program('return "é".repeat(40);'), null, { mostOutputBytes: 50 }))).toMatchObject({
      ran: 'oversized',
    });
    expect(await pool.run(request(program('return input.map((item) => item + 1);'), [1, 2]))).toMatchObject({
      ran: 'answered',
      output: [2, 3],
    });
  });
});

describe('the deadline and the memory of a worker', () => {
  it('terminate a worker at the deadline', async () => {
    const ended = await poolOf({ worker: blocking }).run(request('.', null, { deadlineMs: 500 }));

    expect(ended).toMatchObject({ ran: 'stopped', because: 'deadline' });
    expect(ended.milliseconds).toBeGreaterThanOrEqual(500 - timerSlackMs);
  });

  it('stop a worker whose own heap runs out', async () => {
    const allocating = workerOf('const kept = []; while (true) { kept.push(new Array(100000).fill(1)); }');

    expect(await poolOf({ heapMegabytes: 16, worker: allocating }).run(request('.'))).toMatchObject({
      ran: 'stopped',
      because: 'memory',
    });
  });
});

describe('the workers of a pool', () => {
  it('go on answering on the others while one is blocked, however long it takes', async () => {
    const pool = poolOf();
    const cancelling = new AbortController();
    const blockedForLong = request('.', null, { worker: blocking, deadlineMs: longerThanTheTestMs });
    const stuck = pool.run(blockedForLong, cancelling.signal);

    const meanwhile = await pool.run(request(program('return input + 1;'), 1));
    cancelling.abort();

    expect(meanwhile).toMatchObject({ ran: 'answered', output: 2 });
    expect(await stuck).toMatchObject({ ran: 'stopped', because: 'cancelled' });
  });

  it('turn away a fifth run while four take every worker, once it has waited until its deadline', async () => {
    const pool = poolOf({ worker: blocking });
    const four = Array.from({ length: 4 }, () => pool.run(request('.', null, { deadlineMs: longerThanTheTestMs })));

    const fifth = await pool.run(request('.', null, { deadlineMs: 300 }));

    expect(fifth).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(fifth.milliseconds).toBeGreaterThanOrEqual(300 - timerSlackMs);
    await pool.close();
    expect(await Promise.all(four)).toMatchObject(
      Array.from({ length: 4 }, () => ({ ran: 'stopped', because: 'closing' })),
    );
  });
});

describe('the worker a request names', () => {
  it("answers that request, with the context the request gives, while other requests keep the pool's worker", async () => {
    const echoing = answeringWith("{ context: request.context, worker: 'named' }");
    const pool = poolOf();
    const context = { schema: { type: 'string' } };

    expect(await pool.run(request('.', null, { worker: echoing, context }))).toMatchObject({
      ran: 'answered',
      output: { context, worker: 'named' },
    });
    expect(await pool.run(request('.', null, { worker: echoing }))).toMatchObject({ output: { context: null } });
    expect(await pool.run(request(program('return [input];'), 1))).toMatchObject({ ran: 'answered', output: [1] });
  });
});

describe('a worker that breaks', () => {
  it.each([
    ['throws', 'throw new Error("broken on purpose")', 'The worker failed: broken on purpose'],
    ['ends', 'process.exit(3)', 'The worker ended with code 3 before it answered'],
    [
      'answers with something else',
      'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ nonsense: true });',
      'The worker answered with something that is not an answer',
    ],
    [
      'answers its job with something that is not an answer of the pool',
      'import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ job }) => { parentPort.postMessage({ job, answer: { ran: "folded" }, keep: true }); });',
      'The worker answered with something that is not an answer',
    ],
    [
      'answers a job it was not given',
      'import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ job }) => { parentPort.postMessage({ job: job + 1, answer: { ran: "oversized", work: 0 }, keep: true }); });',
      'The worker answered job 2 while it ran job 1',
    ],
  ])('is answered as crashed when it %s', async (_crash, source, detail) => {
    expect(await poolOf({ worker: workerOf(source) }).run(request('.'))).toMatchObject({ ran: 'crashed', detail });
  });
});

describe('a run of the pool that is cancelled', () => {
  it('stops its worker', async () => {
    const cancelling = new AbortController();
    const starting = nextThreadStarted();
    const run = poolOf({ worker: blocking }).run(request('.'), cancelling.signal);

    const thread = await starting;
    await until(() => isWatched(cancelling.signal));
    cancelling.abort();

    expect(await run).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect(threadEnded(thread)).toBe(true);
  });

  it('starts no worker when it was cancelled before it was admitted', async () => {
    const pool = poolOf({ workers: 1, worker: blocking });
    const first = pool.run(request('.', null, { deadlineMs: longerThanTheTestMs }));
    const cancelling = new AbortController();
    const waiting = pool.run(request('.'), cancelling.signal);

    cancelling.abort();

    expect(await waiting).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    await pool.close();
    expect(await first).toMatchObject({ ran: 'stopped', because: 'closing' });
  });

  it('starts no worker when it comes already cancelled', async () => {
    const cancelling = new AbortController();
    cancelling.abort();

    expect(await poolOf({ worker: blocking }).run(request('.'), cancelling.signal)).toMatchObject({
      ran: 'stopped',
      because: 'cancelled',
    });
  });
});

describe('a closed pool', () => {
  it('takes no more runs', async () => {
    const pool = poolOf();
    await pool.close();

    expect(await pool.run(request('.'))).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});
