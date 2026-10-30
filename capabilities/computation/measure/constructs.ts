import type { Json } from '@on.auto/workflow-engine/dsl';

import { computationBounds } from '../src/run/run-bounds.ts';
import { formatted, functionOf, inTurn, poolOfOne, request } from './common.ts';

interface Construct {
  readonly name: string;
  readonly operation: string;
}

interface Timed {
  readonly name: string;
  readonly milliseconds: number;
  readonly ending: string;
}

const numbers = Array.from({ length: 10_000 }, (_, index) => index);

const data: Json = {
  a: numbers,
  b: numbers.toReversed(),
  o: Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`k${index}`, index])),
  s: 'x'.repeat(200_000),
  r: 'a'.repeat(5000),
  j: JSON.stringify(numbers),
};

const constructs: readonly Construct[] = [
  { name: 'a loop that does nothing', operation: '' },
  { name: 'calling a function', operation: 'step();' },
  { name: 'repeating a string', operation: '"x".repeat(200000);' },
  { name: 'concatenating strings', operation: 'input.s + input.s;' },
  { name: 'concatenating arrays', operation: 'input.a.concat(input.a);' },
  { name: 'spreading arrays', operation: '[...input.a, ...input.a];' },
  { name: 'merging objects', operation: '({ ...input.o, ...input.o });' },
  { name: 'listing entries', operation: 'Object.entries(input.o);' },
  { name: 'encoding JSON', operation: 'JSON.stringify(input.a);' },
  { name: 'decoding JSON', operation: 'JSON.parse(input.j);' },
  { name: 'mapping', operation: 'input.a.map((each) => each + 1);' },
  { name: 'reducing', operation: 'input.a.reduce((sum, each) => sum + each, 0);' },
  { name: 'grouping', operation: 'Map.groupBy(input.a, (each) => each % 10);' },
  {
    name: 'sorting with a comparator',
    operation: 'input.b.toSorted((first, second) => first - second);',
  },
  { name: 'sorting without one', operation: 'input.b.toSorted();' },
  { name: 'making a set', operation: 'new Set(input.a);' },
  { name: 'joining', operation: 'input.a.join(",");' },
  { name: 'splitting', operation: 'input.s.split("x");' },
  { name: 'upper-casing', operation: 'input.s.toUpperCase();' },
  { name: 'searching a string', operation: 'input.s.includes("y");' },
  { name: 'replacing', operation: 'input.s.replaceAll("x", "z");' },
  { name: 'testing a regular expression', operation: '/(a|a|a|a|a|a|a|a|a|a)*b/.test(input.r);' },
];

const deadlineMs = 60_000;

export async function constructsMeasured(): Promise<readonly string[]> {
  const pool = poolOfOne();
  const all = await inTurn(constructs, async ({ name, operation }): Promise<Timed> => {
    const source = functionOf(`const step = () => 0;\n  for (;;) {\n    ${operation}\n  }`);
    const ran = await pool.run(request(source, data, deadlineMs));
    const ending = ran.ran === 'exhausted' ? `exhausted by ${ran.limit}` : ran.ran;
    return { name, milliseconds: ran.milliseconds, ending };
  });
  await pool.close();
  const slowest = all.toSorted((first, second) => second.milliseconds - first.milliseconds);
  return [
    `each of ${all.length} constructs, repeated in a worker until a run's ${formatted(computationBounds.budget)} checkpoints are spent, under a deadline of ${formatted(deadlineMs / 1000)} s:`,
    ...slowest.map(({ name, milliseconds, ending }) => `  ${name}: ${formatted(milliseconds)} ms, ${ending}`),
  ];
}
