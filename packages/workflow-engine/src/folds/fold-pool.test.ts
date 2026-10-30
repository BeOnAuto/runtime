import { afterEach, describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import type { FoldRequest, ModuleAddress, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { moduleOfSource } from '../pool-testing/source-modules.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { longerThanTheTestMs } from '../pool-testing/waiting.ts';
import { programPool } from '../program-pool/program-pool.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import type { FoldingView } from './fold-page.ts';

const timerSlackMs = 2;

const pools: ProgramPool[] = [];

const noSchemaChecked: unknown = expect.stringContaining('checks no view schema');

const noted = { type: 'noted' };

const adding = 'export function fold(view, event) {\n  return view + event.data.n;\n}';

const listing = 'export function fold(view, event) {\n  return [view, event.data.n];\n}';

const keeping = 'export function fold(view) {\n  return view;\n}';

const events: readonly JsonObject[] = [
  { ...noted, data: { n: 1 } },
  { ...noted, data: { n: 2 } },
];

function markingThen(event: number, view: number, then: string): ModuleAddress {
  return moduleOfSource(
    `import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ progress }) => { const place = new Int32Array(progress); Atomics.store(place, 0, ${event}); Atomics.store(place, 1, ${view}); ${then} });`,
  );
}

const markingThenBlocking = markingThen(1, 0, 'while (true) {}');

const foldingAtOnce = moduleOfSource(
  'import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ job }) => { parentPort.postMessage({ job, answer: { ran: "folded", early: false, views: [{ view: "3", folded: 2, lastFolded: 1, through: 1, work: 0 }] }, keep: true }); });',
);

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(4), ...settings });
  pools.push(pool);
  return pool;
}

function viewOf(fold: string, more: Partial<FoldingView> = {}): FoldingView {
  return { fold, filters: [noted], view: 0, events: [0, 1], ...more };
}

function request(views: readonly FoldingView[], more: Partial<FoldRequest> = {}): FoldRequest {
  return {
    events,
    views,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    waitMs: 10_000,
    deadlineMs: 13_000,
    ...more,
  };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe('a page of folds in a worker of the pool', () => {
  it('answers each view after the page, what it folded and the work it did', async () => {
    const outcome = await poolOf().fold(request([viewOf(adding), viewOf(listing, { view: [], events: [1] })]));

    expect(outcome).toMatchObject({
      ran: 'folded',
      early: false,
      views: [
        { view: 3, folded: 2, lastFolded: 1, through: 1 },
        { view: [[], 2], folded: 1, lastFolded: 1, through: 1 },
      ],
    });
    expect(outcome.milliseconds).toBeGreaterThan(0);
  });

  it("stalls a view that keeps a schema, which the engine's own worker checks none of", async () => {
    expect(await poolOf().fold(request([viewOf(adding, { schema: { type: 'integer' } })]))).toMatchObject({
      views: [{ stall: { at: 0, kind: 'schema', message: noSchemaChecked } }],
    });
  });

  it('stalls a fold that overflows the stack of a fixed size every worker gives the sandbox', async () => {
    const recursion = 'export function fold(view) {\n  return fold(view + 1);\n}';

    expect(await poolOf().fold(request([viewOf(recursion)]))).toMatchObject({
      views: [{ stall: { at: 0, kind: 'raised', message: 'InternalError: stack overflow' } }],
    });
  });
});

describe('a page of folds the pool stops', () => {
  it('names the event and the view whose fold was going when it reached its deadline', async () => {
    const outcome = await poolOf({ foldWorker: markingThenBlocking }).fold(
      request([viewOf(keeping)], { deadlineMs: 500 }),
    );

    expect(outcome).toMatchObject({ ran: 'stopped', because: 'deadline', progress: { event: 1, view: 0 } });
    expect(outcome.milliseconds).toBeGreaterThanOrEqual(500 - timerSlackMs);
  });

  it('names the fold that took more memory than its worker has', async () => {
    const markingThenAllocating = markingThen(
      0,
      1,
      'const kept = []; while (true) { kept.push(new Array(100000).fill(kept.length)); }',
    );

    expect(
      await poolOf({ heapMegabytes: 16, foldWorker: markingThenAllocating }).fold(request([viewOf(keeping)])),
    ).toMatchObject({ ran: 'stopped', because: 'memory', progress: { event: 0, view: 1 } });
  });
});

describe('a page of folds that waits for a worker', () => {
  it('counts its deadline from when a worker takes it, after it waited for one longer than that deadline', async () => {
    const pool = poolOf({ workers: 1, foldWorker: foldingAtOnce });
    const busy = pool.run({
      source: '.',
      entry: 'default',
      arguments: [null],
      moment: 0,
      budget: 500,
      memoryBytes: unitMemoryBytes,
      stackBytes: workerStackBytes,
      deadlineMs: 6000,
      mostOutputBytes: 100,
      worker: moduleOfSource('while (true) {}'),
    });

    const folded = await pool.fold(request([viewOf(adding)], { deadlineMs: 5000 }));

    expect(await busy).toMatchObject({ ran: 'stopped', because: 'deadline' });
    expect(folded).toMatchObject({ ran: 'folded', views: [{ view: 3 }] });
    expect(folded.milliseconds).toBeGreaterThan(6000 - timerSlackMs);
  });

  it('is turned away when no worker comes free within its wait, and names no fold', async () => {
    const pool = poolOf({ workers: 1, foldWorker: markingThenBlocking });
    const blocking = pool.fold(request([viewOf(keeping)], { deadlineMs: longerThanTheTestMs }));

    const turnedAway = await pool.fold(request([viewOf(keeping)], { waitMs: 200 }));

    expect(turnedAway).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(turnedAway).not.toHaveProperty('progress');
    await pool.close();
    expect(await blocking).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});

describe('a page of folds that does not end', () => {
  it('is answered as crashed when its worker answers with something else', async () => {
    const nonsense = moduleOfSource(
      'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ran: "folded" });',
    );

    expect(await poolOf({ foldWorker: nonsense }).fold(request([viewOf(keeping)]))).toMatchObject({
      ran: 'crashed',
      detail: 'The worker answered with something that is not an answer',
    });
  });

  it('is stopped when it is cancelled', async () => {
    const cancelling = new AbortController();
    cancelling.abort();

    expect(await poolOf().fold(request([viewOf(keeping)]), cancelling.signal)).toMatchObject({
      ran: 'stopped',
      because: 'cancelled',
    });
  });
});
