import { describe, expect, it } from 'vitest';

import { creditUnits, maximumSpend, MOST_CREDIT_UNITS, type WorkBound } from '../index.ts';

function run(baseUsd = '0', development = '0'): WorkBound {
  return {
    type: 'run',
    resources: [{ category: 'llm', payer: 'auto', baseUsd }],
    developmentUnits: creditUnits(development),
  };
}

describe('bounded run quotes', () => {
  it('includes a workflow, five function runs and all hosted resource bounds', () => {
    const plan: WorkBound = {
      type: 'sequence',
      steps: [run(), run('0.03'), run('0.03'), run('0.03'), run(), run()],
    };
    expect(maximumSpend(plan)).toEqual({
      platformUnits: creditUnits('6'),
      resourceUnits: creditUnits('3.6'),
      developmentUnits: 0n,
      totalUnits: creditUnits('9.6'),
    });
  });

  it('includes concurrent paths and each separately invoked child workflow', () => {
    const child: WorkBound = { type: 'sequence', steps: [run(), run('0.01')] };
    expect(maximumSpend({ type: 'parallel', steps: [child, child] }).totalUnits).toBe(creditUnits('4.8'));
  });

  it('multiplies finite iteration limits before rounding the full resource envelope', () => {
    const result = maximumSpend({ type: 'repeat', iterations: 5n, body: run('0.00000001', '125') });
    expect(result.platformUnits).toBe(creditUnits('5'));
    expect(result.resourceUnits).toBe(2n);
    expect(result.developmentUnits).toBe(creditUnits('625'));
    expect(result.totalUnits).toBe(creditUnits('630') + 2n);
  });

  it('rounds an aggregate maximum upwards', () => {
    expect(maximumSpend(run('0.00000001')).resourceUnits).toBe(1n);
  });

  it('allows a proven empty path and a zero iteration bound', () => {
    expect(maximumSpend({ type: 'sequence', steps: [] }).totalUnits).toBe(0n);
    expect(maximumSpend({ type: 'repeat', iterations: 0n, body: run('1', '125') }).totalUnits).toBe(0n);
  });
});

describe('branch envelopes', () => {
  it('reserves each category maximum so either allowed path fits the approval', () => {
    const result = maximumSpend({
      type: 'branch',
      paths: [{ type: 'repeat', iterations: 4n, body: run() }, run('1'), run('0', '125'), run('0.5', '100')],
    });
    expect(result).toEqual({
      platformUnits: creditUnits('4'),
      resourceUnits: creditUnits('40'),
      developmentUnits: creditUnits('125'),
      totalUnits: creditUnits('169'),
    });
  });

  it('refuses a branch with no possible bounded path', () => {
    expect(() => maximumSpend({ type: 'branch', paths: [] })).toThrow('at least one');
  });
});

describe('unsafe or unknown bounds', () => {
  it('refuses missing resource rates or enforcement limits', () => {
    expect(() => maximumSpend({ type: 'run', resources: undefined, developmentUnits: 0n })).toThrow(
      'known resource rates',
    );
    expect(() => maximumSpend({ type: 'repeat', iterations: undefined, body: run() })).toThrow('finite iteration');
  });

  it('refuses negative iterations and an unsafe aggregate', () => {
    expect(() => maximumSpend({ type: 'repeat', iterations: -1n, body: run() })).toThrow('safe accounting');
    expect(() => maximumSpend({ type: 'repeat', iterations: MOST_CREDIT_UNITS, body: run() })).toThrow(
      'safe accounting',
    );
    expect(() => maximumSpend(run('1e36'))).toThrow('safe accounting');
    expect(() => maximumSpend({ type: 'run', resources: [], developmentUnits: MOST_CREDIT_UNITS })).toThrow(
      'safe accounting',
    );
    expect(() => maximumSpend({ type: 'run', resources: [], developmentUnits: -1n })).toThrow('safe accounting');
  });

  it('refuses deeply nested or oversized plans within a bounded amount of inspection', () => {
    let plan = run();
    for (let depth = 0; depth < 33; depth += 1) plan = { type: 'repeat', iterations: 1n, body: plan };
    expect(() => maximumSpend(plan)).toThrow('plan size or nesting limit');
    const steps = Array.from({ length: 4_096 }, () => run());
    expect(() => maximumSpend({ type: 'parallel', steps })).toThrow('plan size or nesting limit');
  });
});
