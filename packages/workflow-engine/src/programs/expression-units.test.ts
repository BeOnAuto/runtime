import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { expressionUnitOf } from './expression-units.ts';
import type { Evaluation } from './program-run.ts';
import { threadStackBytes, unitMemoryBytes, workerStackBytes } from './sandbox-bounds.ts';
import type { SandboxInstance } from './sandbox-session.ts';

const evaluation: Evaluation = { budget: 250, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock: () => 0 };

function countedInstances(instance: SandboxInstance): {
  readonly instances: () => SandboxInstance;
  readonly taken: () => number;
} {
  const count = { taken: 0 };
  return {
    instances: () => {
      count.taken += 1;
      return instance;
    },
    taken: () => count.taken,
  };
}

describe('a unit of expressions', () => {
  it('takes an instance only when it first evaluates, and keeps it for every expression after', async () => {
    const counted = countedInstances(await freshInstance(shippedFilesOnDisk, unitMemoryBytes));
    const unit = expressionUnitOf(counted.instances, settings);

    const untouched = [unit.took(), counted.taken()];
    const runs = [
      unit.evaluate('$data.total * 2', { data: { total: 21 } }, evaluation),
      unit.evaluate('$input', { input: 'x' }, evaluation),
    ];
    unit.close();

    expect(untouched).toEqual([false, 0]);
    expect(runs).toEqual([
      { ran: 'answered', text: '42', work: 0 },
      { ran: 'answered', text: '"x"', work: 0 },
    ]);
    expect([unit.took(), counted.taken()]).toEqual([true, 1]);
  });

  it('gives each expression a context of its own, so nothing one keeps reaches the next', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);

    const kept = unit.evaluate('Reflect.set(globalThis, "seen", true)', {}, evaluation);
    const later = unit.evaluate('typeof Reflect.get(globalThis, "seen")', {}, evaluation);
    unit.close();

    expect([kept, later]).toMatchObject([{ text: 'true' }, { text: '"undefined"' }]);
  });

  it('passes only the names an expression uses', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);

    const run = unit.evaluate(
      'typeof $context',
      { data: 1, context: { ok: true }, workflow: 'x'.repeat(100_000_000) },
      evaluation,
    );
    unit.close();

    expect(run).toMatchObject({ ran: 'answered', text: '"object"' });
  });
});

describe('an expression a unit refuses', () => {
  it('raises what strict code raises, as the check compiles an expression: a write to a name never declared or to a frozen object', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);

    const runs = [
      unit.evaluate('(() => { undeclared = 1; return 1 })()', {}, evaluation),
      unit.evaluate('(() => { const kept = Object.freeze({ n: 1 }); kept.n = 2; return kept.n })()', {}, evaluation),
    ];
    unit.close();

    const referenceError: unknown = expect.stringContaining('ReferenceError');
    const typeError: unknown = expect.stringContaining('TypeError');

    expect(runs).toMatchObject([
      { ran: 'raised', issue: { detail: referenceError } },
      { ran: 'raised', issue: { detail: typeError } },
    ]);
  });

  it('raises an expression that does not parse, with its line', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);

    const run = unit.evaluate('$data +\n  * 2', { data: 1 }, evaluation);
    unit.close();

    expect(run).toEqual({
      ran: 'raised',
      issue: { detail: "SyntaxError: unexpected token in expression: '*'", line: 2 },
      work: 0,
    });
  });
});

describe('a unit whose instance broke', () => {
  it('answers every expression after its instance refused memory as out of memory, and after its stack broke as out of stack', async () => {
    const refusing = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const growing = expressionUnitOf(() => refusing, settings);
    const breaking = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const deep = expressionUnitOf(() => breaking, { ...settings, stackBytes: workerStackBytes });

    const memory = [
      growing.evaluate(
        '(() => { const kept = []; for (;;) kept.push("y".repeat(1048576) + kept.length) })()',
        {},
        evaluation,
      ),
      growing.evaluate('1 + 1', {}, evaluation),
    ];
    const stack = [
      deep.evaluate('(() => { const down = (depth) => down(depth + 1); return down(0) })()', {}, evaluation),
      deep.evaluate('1 + 1', {}, evaluation),
    ];
    growing.close();
    deep.close();

    expect(memory).toMatchObject([
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'exhausted', limit: 'memory', work: 0 },
    ]);
    expect(stack).toMatchObject([
      { ran: 'exhausted', limit: 'stack' },
      { ran: 'exhausted', limit: 'stack', work: 0 },
    ]);
  });
});
