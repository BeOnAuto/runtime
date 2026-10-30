import { describe, expect, it } from 'vitest';

import { mostExpressionWork, mostValueWork, mostWorkPerInput } from '../machine/limits.ts';
import type { RunOutcome } from '../machine/run-state.ts';
import { drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { errorType } from './raised-error.ts';

const justOverTheBudget = 'x'.repeat(mostValueWork - 15);

const twoHundredCheckpoints =
  '(() => { let sum = 0; for (let index = 0; index < 1000000; index++) sum += index; return sum })()';

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

describe('an expression of a task', () => {
  it('that fails raises an expression error with what went wrong', () => {
    const run = drivenRun(workflow("do:\n  - broken: { set: '${ $data.missing.field }' }"));

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('expression'),
        status: 400,
        title: 'An expression failed',
        detail: "$data.missing.field: TypeError: cannot read property 'field' of undefined",
        instance: '/do/0/broken',
      },
    });
  });

  it('that does more work than an expression may raises a runtime error', () => {
    const run = drivenRun(workflow("do:\n  - heavy: { set: '${ (() => { for (;;) {} })() }' }"));

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`: an expression may do ${mostExpressionWork} checkpoints of work$`, 'u'),
    );
  });

  it('that does more work than is left of the input raises a runtime error that says so', () => {
    const heavy = `'\${ ${twoHundredCheckpoints} }'`;
    const run = drivenRun(workflow(`do:\n  - heavy: { set: { a: ${heavy}, b: ${heavy}, c: ${heavy} } }`));

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`: the workflow did ${mostWorkPerInput} checkpoints of expression work in one input; `, 'u'),
    );
  });
});

describe('a value an expression of a task builds', () => {
  it('nested deeper than 512 levels raises an expression error that names where', () => {
    const run = drivenRun(
      workflow(
        "do:\n  - deep: { set: '${ (() => { let value = null; for (let level = 0; level < 600; level++) value = [value]; return value })() }' }",
      ),
    );

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { type: errorType('expression'), status: 400, title: 'An expression failed', instance: '/do/0/deep' },
    });
    expect(JSON.stringify(run.outcome)).toContain('The answer holds a value deeper than 512 levels at $[0][0]');
  });
});

describe('a value a task gives', () => {
  it('that takes more work to visit than a workflow may hold raises a runtime error', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
      respond: () => ({ result: { status: 'succeeded', output: justOverTheBudget } }),
    });

    expect(titleOf(run.outcome)).toBe(
      `A value takes ${mostValueWork + 1} units of work to visit, more than the ${mostValueWork} a workflow may hold`,
    );
  });
});

describe('a duration of a task', () => {
  it('that is not a duration raises a configuration error', () => {
    expect(titleOf(drivenRun(workflow('do:\n  - pause: { wait: soon }')).outcome)).toMatch(
      /^A duration of the task is not valid: /u,
    );
  });

  it('that is longer than the workflow may run raises a configuration error', () => {
    const run = drivenRun(workflow('do:\n  - pause: { wait: P31D }'));

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'A duration of the task, 2678400000 ms, is longer than the 2592000000 ms a workflow may run' },
    });
  });
});
