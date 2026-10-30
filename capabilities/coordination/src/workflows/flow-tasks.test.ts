import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

describe('flow directives', () => {
  it('jump to a named task of the same list, back as well as forth', async () => {
    const document = workflow(`
do:
  - start:
      set: { laps: 0 }
      then: lap
  - skipped:
      set: { skipped: true }
  - lap:
      set: { laps: '\${ $data.laps + 1 }' }
  - again:
      switch:
        - more:
            when: $data.laps < 3
            then: lap
        - done:
            then: continue
  - finish:
      set: { laps: '\${ $data.laps }', finished: true }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { laps: 3, finished: true } });
  });

  it('end the workflow with end, from any depth', async () => {
    const document = workflow(`
do:
  - outer:
      do:
        - inner:
            set: { stopped: inner }
            then: end
        - never:
            set: { stopped: never }
  - after:
      set: { stopped: after }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { stopped: 'inner' } });
  });
});

describe('flow directives that leave', () => {
  it('leave the enclosing list with exit, and the workflow when that list is the top one', async () => {
    const document = workflow(`
do:
  - outer:
      do:
        - inner:
            set: { left: inner }
            then: exit
        - never:
            set: { left: never }
  - after:
      set: { left: '\${ $data.left + ", then after" }' }
      then: exit
  - never:
      set: { left: never }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { left: 'inner, then after' } });
  });
});

describe('a jump', () => {
  it('raises a configuration error when it names a task to a task that is not there', async () => {
    const document = workflow(`
do:
  - lost:
      switch:
        - always:
            then: nowhere
`);

    expect((await interpret(document)).ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'then: nowhere names no task in the same list, at the step lost.',
    });
  });
});

const routing = workflow(`
do:
  - route:
      switch:
        - big:
            when: $data.size > 10
            then: large
        - fallback:
            then: small
  - small:
      set: { label: small }
      then: end
  - large:
      set: { label: large }
`);

describe('a switch', () => {
  it('follows the first case whose condition holds', async () => {
    expect((await interpret(routing, { input: { size: 20 } })).ending).toEqual({
      kind: 'completed',
      output: { label: 'large' },
    });
  });

  it('follows the case without a condition when no other holds', async () => {
    expect((await interpret(routing, { input: { size: 2 } })).ending).toEqual({
      kind: 'completed',
      output: { label: 'small' },
    });
  });
});

describe('a switch without a default', () => {
  it('continues when no case holds', async () => {
    const document = workflow(`
do:
  - route:
      switch:
        - big: { when: $data.size > 10, then: end }
        - odd: 3
  - after:
      set: { continued: true }
`);

    expect((await interpret(document, { input: { size: 1 } })).ending).toEqual({
      kind: 'completed',
      output: { continued: true },
    });
  });
});
