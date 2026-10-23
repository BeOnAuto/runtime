import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import {
  freshInstances,
  handedWorkersOf,
  programPool,
  runMemoryBytes,
  threadStackBytes,
  unitMemoryBytes,
  type ProgramRun,
} from '../src/dsl.ts';
import { sandboxModuleFile } from '../src/instances/compiled-module.ts';
import { expressionUnitOf } from '../src/programs/expression-units.ts';
import { filterContextOf } from '../src/programs/kept-contexts.ts';
import { moduleRun } from '../src/programs/module-runs.ts';
import type { Evaluation } from '../src/programs/program-run.ts';
import { sandboxRuntimeOf } from '../src/programs/sandbox-session.ts';
import { medianMillisecondsOf, millisecondsOf } from './common.ts';

const unbounded: Evaluation = { budget: Number.POSITIVE_INFINITY, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 16_777_216, clock: () => performance.now() };

const decision = { decision: { decision: 'approve', reason: 'the budget is stated' } };

const branching = [
  'export default function () {',
  '  const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));',
  '  const sorted = Array.from({ length: 5000 }, (_, index) => (index * 7919) % 1000).toSorted((a, b) => a - b);',
  '  return [fib(22), sorted[2500]];',
  '}',
].join('\n');

function formatted(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

async function medianAsync(times: number, work: () => Promise<number>): Promise<number> {
  const samples = await inTurn(Array.from({ length: times }), work);
  return samples.toSorted((first, second) => first - second)[Math.floor(times / 2)] ?? 0;
}

async function ranModule(
  source: string,
  args: readonly string[],
  evaluation: Evaluation = unbounded,
): Promise<ProgramRun> {
  const run = moduleRun(await freshInstances(shippedFilesOnDisk)(unitMemoryBytes), settings, {
    source,
    entry: 'default',
    arguments: args,
    evaluation,
  });
  if (run.ran === 'refused') {
    throw new Error(run.issue.detail);
  }
  return run;
}

async function instanceLines(): Promise<readonly string[]> {
  const wasm = await shippedFilesOnDisk.bytes(sandboxModuleFile);
  await freshInstances(shippedFilesOnDisk)(unitMemoryBytes);
  const fresh = await medianAsync(50, async () => {
    const started = performance.now();
    await freshInstances(shippedFilesOnDisk)(unitMemoryBytes);
    return performance.now() - started;
  });
  const withPrelude = await medianAsync(50, async () => {
    const started = performance.now();
    const runtime = sandboxRuntimeOf(await freshInstances(shippedFilesOnDisk)(runMemoryBytes), settings);
    runtime.context().close();
    const milliseconds = performance.now() - started;
    runtime.close();
    return milliseconds;
  });
  return [
    `the WebAssembly file: ${formatted(wasm.byteLength, 0)} bytes`,
    `a fresh instance of the compiled module, memory maximum 64 MiB: ${formatted(fresh, 2)} ms at the median of 50; 256 MiB with a runtime, a context and the prelude: ${formatted(withPrelude, 2)} ms`,
  ];
}

async function checkpointLines(): Promise<readonly string[]> {
  const loop = await ranModule('export default function () {\n  for (;;) {}\n}', [], {
    ...unbounded,
    budget: 200,
  });
  const timed = async (body: string, budget: number): Promise<number> => {
    const started = performance.now();
    await ranModule(`export default function () {\n  ${body}\n}`, [], { ...unbounded, budget });
    return performance.now() - started;
  };
  const answering = await medianAsync(9, () => timed('return 0;', 200));
  const perCheckpoint = async (body: string): Promise<number> =>
    ((await medianAsync(9, () => timed(body, 200))) - answering) / 200;
  const counts = await Promise.all([ranModule(branching, []), ranModule(branching, []), ranModule(branching, [])]);
  const regex = performance.now();
  const backtracking = await ranModule(
    'export default function () {\n  return /^(a+)+$/.test("a".repeat(30) + "b");\n}',
    [],
    { ...unbounded, budget: 200 },
  );
  const regexMs = performance.now() - regex;
  return [
    `checkpoints of a program with branching and recursion, three runs: ${counts.map(({ work }) => work).join(', ')}; a loop stopped at its budget of 200: ${loop.work}`,
    `one checkpoint of a tight loop: ${formatted(await perCheckpoint('for (;;) {}'), 3)} ms; of a loop of calls: ${formatted(await perCheckpoint('const step = () => 0;\n  for (;;) step();'), 3)} ms, at the median of 9 runs of 200, less a run that answers at once`,
    `the catastrophic pattern over 30 a's and a b: ${backtracking.ran} by ${backtracking.ran === 'exhausted' ? backtracking.limit : 'nothing'} after ${backtracking.work} checkpoints, ${formatted(regexMs, 1)} ms`,
  ];
}

async function expressionLines(): Promise<readonly string[]> {
  const instance = await freshInstances(shippedFilesOnDisk)(unitMemoryBytes);
  const unit = expressionUnitOf(() => instance, settings);
  const fresh = medianMillisecondsOf(201, () => {
    unit.evaluate('$context.decision.decision == "approve"', { context: decision }, unbounded);
  });
  unit.close();
  const filters = filterContextOf(await freshInstances(shippedFilesOnDisk)(unitMemoryBytes), settings, unbounded);
  const test = filters.define(' $data.decision.decision == "approve" ');
  const freezing = millisecondsOf(() => {
    filters.freeze();
  });
  const data = JSON.stringify(decision);
  const reused = medianMillisecondsOf(201, () => {
    test(data, unbounded);
  });
  filters.close();
  return [
    `an expression, $context.decision.decision == "approve", in a fresh context with the prelude: ${formatted(fresh, 3)} ms at the median of 201; the freeze of a context that serves many: ${formatted(freezing, 2)} ms; the same expression in a reused context: ${formatted(reused, 3)} ms`,
  ];
}

function building(answer: string): string {
  return `export default function (input) {\n  const value = input.map((row) => ({ row }));\n  return ${answer};\n}`;
}

async function valueLines(): Promise<readonly string[]> {
  const rows = Array.from({ length: 2600 }, (_, index) => ({
    id: index,
    campaign: `campaign-${index % 40}`,
    amount: index * 3.5,
    note: 'x'.repeat(40),
  }));
  const input = JSON.stringify(rows);
  const echo = 'export default function (input) {\n  return input;\n}';
  const started = performance.now();
  const echoed = await ranModule(echo, [input]);
  const crossing = performance.now() - started;
  const plain = await medianAsync(9, async () => {
    const at = performance.now();
    await ranModule(building('JSON.stringify(value).length'), [input]);
    return performance.now() - at;
  });
  const refusing = await medianAsync(9, async () => {
    const at = performance.now();
    await ranModule(building('value'), [input]);
    return performance.now() - at;
  });
  return [
    `a value of ${formatted(input.length, 0)} bytes in as JSON text and its answer out: ${formatted(crossing, 1)} ms (${echoed.ran})`,
    `the same value written in the sandbox by JSON.stringify and answered as its length, against answered and read by the refusing replacer: ${formatted(plain, 1)} ms and ${formatted(refusing, 1)} ms at the median of 9`,
  ];
}

async function stackLines(): Promise<readonly string[]> {
  const pool = programPool({
    handed: await handedWorkersOf(shippedFilesOnDisk),
    instances: 'fresh',
    workers: 1,
    heapMegabytes: 256,
  });
  const deepest =
    'export default function () {\n  let deepest = 0;\n  const down = (depth) => {\n    deepest = depth;\n    return down(depth + 1);\n  };\n  try {\n    down(0);\n  } catch {\n    return deepest;\n  }\n  return -1;\n}';
  const depthAt = async (stackBytes: number): Promise<string> => {
    const outcome = await pool.run({
      source: deepest,
      entry: 'default',
      arguments: [],
      moment: 0,
      budget: 20_000,
      memoryBytes: runMemoryBytes,
      stackBytes,
      deadlineMs: 10_000,
      mostOutputBytes: 100,
    });
    return outcome.ran === 'answered' ? JSON.stringify(outcome.output) : outcome.ran;
  };
  const depths = await inTurn([65_536, 262_144, 524_288, 1_048_576], async (stackBytes) => {
    const twice = await inTurn([0, 1], () => depthAt(stackBytes));
    return `${stackBytes / 1024} KiB ${twice.join(' and ')}`;
  });
  await pool.close();
  return [`the depth at which the stack overflows, in a worker of the pool, twice each: ${depths.join('; ')}`];
}

export async function sandboxMeasured(): Promise<readonly string[]> {
  return [
    ...(await instanceLines()),
    ...(await checkpointLines()),
    ...(await expressionLines()),
    ...(await valueLines()),
    ...(await stackLines()),
  ];
}
