import { describe, expect, it } from 'vitest';

import type { RunSettlement } from '../testing/run-terms.ts';
import { runId, interpret, outputsAtTimeZero, workflow } from '../testing/workflows.ts';

function tasks(count: number, body: (index: number) => string): string {
  return `do:\n${Array.from({ length: count }, (_, index) => `  - t${index}: ${body(index)}`).join('\n')}`;
}

function rejectionOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

function yieldsIn(commands: Awaited<ReturnType<typeof interpret>>['commands']): readonly string[] {
  return commands.flatMap((command) =>
    command.kind === 'timer' && command.summary.endsWith('lets other workflows run') ? [command.summary] : [],
  );
}

describe('a workflow whose expressions do too much work', () => {
  it('fails with a runtime error at the first expression past the budget of an expression', async () => {
    const document = workflow(tasks(6, () => `{ set: { size: '\${ (() => { for (;;) {} })() }' } }`));
    const { ending, settlement } = await interpret(document);

    expect(ending).toMatchObject({ kind: 'failed' });
    expect(settlement).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(rejectionOf(settlement)).toContain('an expression may do 250 checkpoints of work, at the step t0.');
  });

  it('fails once one task does more than one input may, since it can yield only between tasks', async () => {
    const big = `'\${ (() => { let spent = 0; for (let index = 0; index < 1000000; index++) spent += index; return spent })() }'`;
    const { settlement } = await interpret(workflow(`do:\n  - heavy: { set: { a: ${big}, b: ${big}, c: ${big} } }`));

    expect(rejectionOf(settlement)).toContain('the workflow did 500 checkpoints of expression work in one input');
  });
});

describe('a workflow that runs many pure tasks', () => {
  it('lets other workflows run before a task once its tasks did the budget of an expression', async () => {
    const document = workflow(
      tasks(
        6,
        () =>
          `{ set: { size: '\${ (() => { let size = 0; for (let index = 0; index < 300000; index++) size += 1; return size })() }' } }`,
      ),
    );
    const { ending, commands } = await interpret(document);

    expect(ending).toStrictEqual({ kind: 'completed', output: { size: 300_000 } });
    expect(yieldsIn(commands)).toStrictEqual(['/do/5/t5 lets other workflows run']);
  });

  it('lets other workflows run after every hundred tasks', async () => {
    const { ending, commands } = await interpret(workflow(tasks(250, (index) => `{ set: { n: ${index} } }`)));

    expect(ending).toStrictEqual({ kind: 'completed', output: { n: 249 } });
    expect(yieldsIn(commands)).toStrictEqual([
      '/do/100/t100 lets other workflows run',
      '/do/200/t200 lets other workflows run',
    ]);
  });
});

const zerosJustOverTheBudget = Array.from({ length: 500_000 }, () => 0);

describe('a value a workflow holds', () => {
  it('may not take more work to visit than an expression may do', async () => {
    const half = `'\${ "x".repeat(5000000) }'`;
    const { settlement } = await interpret(workflow(`do:\n  - pair: { set: { a: ${half}, b: ${half} } }`));

    expect(rejectionOf(settlement)).toContain(
      'units of work to visit, more than the 8000000 a workflow may hold, at the step pair.',
    );
  });

  it('is admitted as the input of a workflow only if it takes no more work than that', () => {
    expect(outputsAtTimeZero(workflow('do: []'), zerosJustOverTheBudget)).toEqual([
      {
        kind: 'settle',
        runId,
        settlement: {
          status: 'rejected',
          reason: 'unavailable',
          detail: 'A value takes 8000016 units of work to visit, more than the 8000000 a workflow may hold.',
        },
      },
    ]);
  });

  it('may not double by sharing itself from task to task', async () => {
    const { settlement } = await interpret(
      workflow(tasks(40, () => `{ set: { a: '\${ $data }', b: '\${ $data }' } }`)),
      { input: { text: 'x'.repeat(600_000) } },
    );

    expect(rejectionOf(settlement)).toContain('a workflow may hold, at the step t3.');
  });

  it('may not nest more than 512 levels deep', async () => {
    const deep = `'\${ Array.from({ length: 511 }).reduce((inner) => [inner], 0) }'`;
    const { settlement } = await interpret(workflow(`do:\n  - deep: { set: { a: { b: ${deep} } } }`));

    expect(rejectionOf(settlement)).toContain('A value nests more than 512 levels deep, at the step deep.');
  });
});
