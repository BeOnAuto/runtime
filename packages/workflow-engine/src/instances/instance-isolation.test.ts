import { describe, expect, it } from 'vitest';

import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { expressionUnitOf } from '../programs/expression-units.ts';
import { moduleRun, type ModuleRun } from '../programs/module-runs.ts';
import { threadStackBytes, unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import type { InstanceSource } from './instance-source.ts';

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

async function ran(source: InstanceSource, program: string): Promise<ModuleRun> {
  return moduleRun(await source(unitMemoryBytes), settings, {
    source: program,
    entry: 'default',
    arguments: [],
    evaluation,
  });
}

function returning(body: string): string {
  return `export default function () {\n  ${body}\n}`;
}

const counting = 'let count = 0;\nexport default function () {\n  count += 1;\n  return count;\n}';

const leaving = returning(
  [
    'Reflect.set(globalThis, "left", "a global");',
    'Object.prototype.polluted = "a prototype";',
    'Array.prototype.push = () => 0;',
    'Reflect.set(globalThis, Symbol.for("left"), "a symbol");',
    'return [Reflect.get(globalThis, "left"), ({}).polluted, [].push(1), Reflect.get(globalThis, Symbol.for("left"))];',
  ].join('\n  '),
);

const looking = returning(
  'return [typeof Reflect.get(globalThis, "left"), typeof ({}).polluted, [].push(1), typeof Reflect.get(globalThis, Symbol.for("left"))];',
);

const bufferBytes = 4 * 1_048_576;

async function brokenStackOn(source: InstanceSource): Promise<unknown> {
  const instance = await source(unitMemoryBytes);
  const unit = expressionUnitOf(() => instance, { ...settings, stackBytes: workerStackBytes });
  const run = unit.evaluate('(() => { const down = (depth) => down(depth + 1); return down(0) })()', {}, evaluation);
  unit.close();
  return run;
}

describe.each(sourcesUnderTest)('the units the $name source serves one after another', ({ source }) => {
  it('see nothing an earlier one left: a value, a global, a prototype it changed and a Symbol it registered', async () => {
    const runs = [
      await ran(source, counting),
      await ran(source, counting),
      await ran(source, leaving),
      await ran(source, looking),
    ];

    expect(runs).toMatchObject([
      { ran: 'answered', text: '1' },
      { ran: 'answered', text: '1' },
      { ran: 'answered', text: '["a global","a prototype",0,"a symbol"]' },
      { ran: 'answered', text: '["undefined","undefined",1,"undefined"]' },
    ]);
  });

  it('read no byte of the memory an earlier one wrote', async () => {
    const writing = returning(`new Uint8Array(new ArrayBuffer(${bufferBytes})).fill(171);\n  return 0;`);
    const reading = returning(
      `const read = new Uint8Array(new ArrayBuffer(${bufferBytes}));\n  return [read.indexOf(171), read.lastIndexOf(0)];`,
    );

    expect([await ran(source, writing), await ran(source, reading)]).toMatchObject([
      { ran: 'answered', text: '0' },
      { ran: 'answered', text: `[-1,${bufferBytes - 1}]` },
    ]);
  });

  it('answer after one that broke the stack of the thread it ran on', async () => {
    expect([await brokenStackOn(source), await ran(source, returning('return 1 + 1;'))]).toMatchObject([
      { ran: 'exhausted', limit: 'stack' },
      { ran: 'answered', text: '2' },
    ]);
  });
});
