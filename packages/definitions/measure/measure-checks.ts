import { cpus } from 'node:os';

import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import {
  freshInstances,
  programPool,
  sandboxAnswers,
  sandboxModuleIn,
  type CheckJob,
} from '@on.auto/workflow-engine/dsl';

import { checkerOf } from '../src/program-check/checking.ts';
import { sandboxLibFrom } from '../src/program-check/kept-lib.ts';
import { sandboxLibOf } from '../src/program-check/sandbox-lib.ts';
import { checkWorker, handedWorkersWithChecks, checkShippedRoots } from '../src/program-check/save-check.ts';
import { keptLibOnDisk } from '../src/testing/read-on-disk.ts';

const shippedFiles = shippedFilesOnDisk(checkShippedRoots());

const schemas = {
  input: {
    type: 'object',
    required: ['rows', 'period'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['campaign', 'cost_cents', 'budget_cents'],
          properties: {
            campaign: { type: 'string' },
            cost_cents: { type: 'integer' },
            budget_cents: { type: 'integer' },
          },
        },
      },
      period: {
        type: 'object',
        required: ['days_elapsed', 'days_total'],
        properties: { days_elapsed: { type: 'integer' }, days_total: { type: 'integer' } },
      },
    },
  },
  output: {
    type: 'object',
    required: ['campaigns', 'total_spend_cents'],
    properties: { campaigns: { type: 'array', items: { type: 'object' } }, total_spend_cents: { type: 'integer' } },
  },
};

const pace = [
  'export default function (input: Input): Output {',
  '  const { days_elapsed, days_total } = input.period;',
  '  const campaigns = [...Map.groupBy(input.rows, (row) => row.campaign)]',
  '    .toSorted(([first], [second]) => (first < second ? -1 : 1))',
  '    .map(([campaign, rows]) => {',
  '      const spend_cents = rows.reduce((sum, row) => sum + row.cost_cents, 0);',
  '      const budget_cents = rows[0].budget_cents;',
  '      const projected_cents = Math.floor((spend_cents * days_total) / days_elapsed);',
  '      const pace_permille = budget_cents === 0 ? null : Math.floor((projected_cents * 1000) / budget_cents);',
  '      return { campaign, spend_cents, budget_cents, projected_cents, pace_permille };',
  '    });',
  '  return { campaigns, total_spend_cents: campaigns.reduce((sum, each) => sum + each.spend_cents, 0) };',
  '}',
].join('\n');

const table = [
  'export default function (input: Input): Output {',
  '  const rates: Record<string, number> = {',
  ...Array.from({ length: 3650 }, (_, index) => `    rate${index}: ${index % 97},`),
  '  };',
  "  return { campaigns: [], total_spend_cents: input.period.days_total * (rates['rate1'] ?? 0) };",
  '}',
].join('\n');

function assigning(times: number): string {
  return [
    'export default function (input: Input): Output {',
    '  let total = 0;',
    ...Array.from({ length: times }, (_, index) => `  total += input.period.days_total * ${index % 97};`),
    '  return { campaigns: [], total_spend_cents: total };',
    '}',
  ].join('\n');
}

const reassigned = assigning(500);

const overAssigned = assigning(2150);

const computation = (source: string): CheckJob => ({
  module: { place: 'computation', source },
  schemas,
  expressions: [],
});

const expressions = (count: number): CheckJob => ({
  schemas: {},
  expressions: Array.from({ length: count }, (_, index) => ({
    source: ` ({ ...$context, n: ($data.n ?? 0) + ${index} }) `,
    names: ['$data', '$context', '$input'],
  })),
});

function median(values: readonly number[]): number {
  const sorted = values.toSorted((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function timed(work: () => unknown): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

const [cpu] = cpus();
write(`Node ${process.version} on ${cpu?.model ?? 'an unknown processor'}, ${cpus().length} cores`);

const sandboxModule = await sandboxModuleIn(shippedFiles);

const generating = performance.now();
const generated = await sandboxLibOf(shippedFiles, (probed) => sandboxAnswers(freshInstances(sandboxModule), probed));
write(
  `the lib generated in ${(performance.now() - generating).toFixed(0)} ms: ${generated.script.length} and ${generated.iterator.length} characters`,
);

const making = performance.now();
const check = checkerOf(sandboxLibFrom(keptLibOnDisk));
write(`the checker made from the kept lib in ${(performance.now() - making).toFixed(1)} ms`);
write(`the example, its first check in the thread: ${timed(() => check(computation(pace))).toFixed(1)} ms`);

const cases: readonly (readonly [string, CheckJob])[] = [
  ['the example', computation(pace)],
  ['one expression', expressions(1)],
  ['a hundred expressions', expressions(100)],
  [`a program of ${table.length} characters, a table in one function`, computation(table)],
  [`a program of ${reassigned.length} characters, one variable assigned 500 times`, computation(reassigned)],
  [
    `a program of ${overAssigned.length} characters, one variable assigned 2,150 times, which the walk refuses before the compiler analyses it`,
    computation(overAssigned),
  ],
];

for (const [name, job] of cases) {
  write(
    `${name}, warm, at the median of 9: ${median(Array.from({ length: 9 }, () => timed(() => check(job)))).toFixed(1)} ms`,
  );
}

const handed = await handedWorkersWithChecks(shippedFiles);
const pool = programPool({ workers: 1, heapMegabytes: 256, handed, instances: 'fresh' });
const checkedBy = { worker: checkWorker };
const cold = await pool.check({ ...computation(pace), deadlineMs: 60_000, ...checkedBy });
const warm = await pool.check({ ...computation(pace), deadlineMs: 60_000, ...checkedBy });
write(
  `the example in the pool's check worker: ${cold.milliseconds.toFixed(1)} ms the first, the worker's start included, then ${warm.milliseconds.toFixed(1)} ms`,
);
await pool.close();
