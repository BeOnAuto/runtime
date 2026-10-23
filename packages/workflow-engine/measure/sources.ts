import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import {
  handedWorkersOf,
  programPool,
  runMemoryBytes,
  threadStackBytes,
  unitMemoryBytes,
  workerStackBytes,
  type InstanceSource,
  type InstanceSourceName,
  type ProgramPool,
  sandboxModuleIn,
  sandboxShippedRoots,
} from '../src/dsl.ts';
import { instanceSources } from '../src/instances/instance-sources.ts';
import { moduleRun } from '../src/programs/module-runs.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots);

type Timings = Readonly<Record<InstanceSourceName, number>>;

const sandboxModule = await sandboxModuleIn(sandboxFiles);

const answering = 'export default function () {\n  return 0;\n}';

const spending = 'export default function () {\n  for (;;) {}\n}';

const runBudget = 20_000;

const keepingStrings =
  '(() => { const kept = []; try { for (;;) kept.push("y".repeat(1048576) + kept.length); } catch { return kept.length; } })()';

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1000, clock: () => performance.now() };

function formatted(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function median(samples: readonly number[]): number {
  return samples.toSorted((first, second) => first - second)[Math.floor(samples.length / 2)] ?? 0;
}

function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

async function unitMs(source: InstanceSource, program: string): Promise<number> {
  const started = performance.now();
  moduleRun(await source(unitMemoryBytes), settings, {
    source: program,
    entry: 'default',
    arguments: [],
    evaluation: { budget: runBudget, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 },
  });
  return performance.now() - started;
}

async function alternately(times: number, sample: (name: InstanceSourceName) => Promise<number>): Promise<Timings> {
  const turns = await inTurn(Array.from({ length: times }), async (): Promise<Timings> => ({
    fresh: await sample('fresh'),
    kept: await sample('kept'),
  }));
  return { fresh: median(turns.map(({ fresh }) => fresh)), kept: median(turns.map(({ kept }) => kept)) };
}

function sourceOf(name: InstanceSourceName): InstanceSource {
  return instanceSources[name](sandboxModule);
}

async function onThread(): Promise<Readonly<Record<'cold' | 'warm' | 'spent', Timings>>> {
  await unitMs(sourceOf('fresh'), answering);
  const cold = await alternately(9, (name) => unitMs(sourceOf(name), answering));
  const serving = { fresh: sourceOf('fresh'), kept: sourceOf('kept') };
  await alternately(1, (name) => unitMs(serving[name], answering));
  const warm = await alternately(201, (name) => unitMs(serving[name], answering));
  const spent = await alternately(9, (name) => unitMs(serving[name], spending));
  return { cold, warm, spent };
}

async function poolOf(name: InstanceSourceName): Promise<ProgramPool> {
  return programPool({
    handed: await handedWorkersOf(sandboxFiles),
    instances: name,
    workers: 1,
    heapMegabytes: 256,
  });
}

async function inPools(): Promise<Timings> {
  const pools = { fresh: await poolOf('fresh'), kept: await poolOf('kept') };
  const run = async (name: InstanceSourceName): Promise<number> => {
    const outcome = await pools[name].run({
      source: answering,
      entry: 'default',
      arguments: [],
      moment: 0,
      budget: runBudget,
      memoryBytes: runMemoryBytes,
      stackBytes: workerStackBytes,
      deadlineMs: 10_000,
      mostOutputBytes: 1000,
    });
    return outcome.milliseconds;
  };
  await alternately(1, run);
  const warm = await alternately(30, run);
  await Promise.all([pools.fresh.close(), pools.kept.close()]);
  return warm;
}

async function stringsKept(memoryBytes: number, runtimeLimit?: number): Promise<number> {
  const { module } = await sourceOf('fresh')(memoryBytes);
  const runtime = module.newRuntime();
  if (runtimeLimit !== undefined) {
    runtime.setMemoryLimit(runtimeLimit);
  }
  const context = runtime.newContext();
  const kept = context.getNumber(context.unwrapResult(context.evalCode(keepingStrings)));
  context.dispose();
  runtime.dispose();
  return kept;
}

function both({ fresh, kept }: Timings, digits: number): string {
  return `fresh ${formatted(fresh, digits)} ms, kept ${formatted(kept, digits)} ms`;
}

export async function sourcesMeasured(): Promise<readonly string[]> {
  const { cold, warm, spent } = await onThread();
  const pooled = await inPools();
  const underTheLimit = await stringsKept(runMemoryBytes, unitMemoryBytes);
  const underTheMaximum = await stringsKept(unitMemoryBytes);
  return [
    `a unit of the smallest program, a module answering 0, on the thread that measures, cold, the first of a source made anew, at the median of 9: ${both(cold, 3)}`,
    `the same unit warm, on a source that served one before, at the median of 201: ${both(warm, 3)}`,
    `a unit that spends a run's budget of ${formatted(runBudget, 0)} checkpoints, warm, at the median of 9: ${both(spent, 1)}`,
    `a warm run of the smallest program through a pool of one worker, at the median of 30: ${both(pooled, 3)}`,
    `strings of 1 MiB kept under a runtime's own memory limit of 64 MiB, on an instance of 256 MiB: ${underTheLimit}; under an instance maximum of 64 MiB: ${underTheMaximum}`,
  ];
}
