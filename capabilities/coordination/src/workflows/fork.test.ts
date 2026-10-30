import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

const racing = workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - slow:
              do:
                - pause: { wait: PT10S }
                - mark: { set: { winner: slow } }
          - fast:
              wait: PT1S
          - failing:
              raise:
                error: { type: https://example.com/broken, status: 500 }
  - after:
      set: { finished: '\${ $data }' }
`);

describe('a fork', () => {
  it('runs its branches at once and outputs their outputs in order', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - left:
              wait: PT2S
          - right:
              set: { side: right }
`);

    const { ending, fake } = await interpret(document, { input: { side: 'left' } });

    expect(ending).toEqual({ kind: 'completed', output: [{ side: 'left' }, { side: 'right' }] });
    expect(fake.now() - Date.parse('2026-10-01T09:00:00.000Z')).toBe(2000);
  });

  it('outputs an empty list when it has no branches', async () => {
    expect((await interpret(workflow('do:\n  - none: { fork: { branches: [] } }'))).ending).toEqual({
      kind: 'completed',
      output: [],
    });
  });
});

describe('a fork whose branches compete', () => {
  it('outputs the first branch to succeed and cancels the others', async () => {
    const { ending, commands } = await interpret(racing, { input: { winner: 'fast' } });

    expect(ending).toEqual({ kind: 'completed', output: { finished: { winner: 'fast' } } });
    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/race/fork/branches/0/slow/do/0/pause' });
  });

  it('outputs null when it has no branches', async () => {
    expect((await interpret(workflow('do:\n  - none: { fork: { compete: true, branches: [] } }'))).ending).toEqual({
      kind: 'completed',
      output: null,
    });
  });

  it('raises the first error when every branch fails', async () => {
    const document = workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - first: { raise: { error: { type: https://example.com/first, status: 503 } } }
          - second: { raise: { error: { type: https://example.com/second, status: 503 } } }
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'https://example.com/first, at the step first.',
    });
  });
});

const failingAtOnce = workflow(`
do:
  - both:
      fork:
        branches:
          - waiting: { wait: PT1H }
          - failing: { raise: { error: { type: https://example.com/broken, status: 400 } } }
`);

describe('a fork whose branch fails', () => {
  it('raises the error', async () => {
    expect((await interpret(failingAtOnce)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'https://example.com/broken, at the step failing.',
    });
  });

  it('ends the workflow when a branch ends it', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - stopping: { set: { stopped: true }, then: end }
          - going: { set: { going: true } }
  - after:
      set: { after: true }
`);

    expect((await interpret(document)).ending).toEqual({
      kind: 'completed',
      output: [{ stopped: true }, { going: true }],
    });
  });
});
