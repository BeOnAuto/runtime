import { mostStepsWithoutWaiting } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { runId, interpret, outputsAtTimeZero, workflow } from '../testing/workflows.ts';

describe('a workflow that never waits', () => {
  it('is stopped once it has run too many tasks without waiting', () => {
    const document = workflow(`
do:
  - spin:
      set: { turn: 1 }
      then: spin
`);

    expect(outputsAtTimeZero(document).at(-1)).toEqual({
      kind: 'settle',
      runId,
      settlement: {
        status: 'rejected',
        reason: 'unavailable',
        detail: `The workflow ran ${mostStepsWithoutWaiting} tasks without waiting for anything; it would never end, at the step spin.`,
      },
    });
  });

  it('may run many tasks as long as it waits in between', async () => {
    const document = workflow(`
do:
  - spin:
      for: { in: '\${ [0, 1, 2] }' }
      do:
        - count: { set: { turns: '\${ ($data.turns ?? 0) + 1 }' } }
        - rest: { wait: PT1S }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { turns: 3 } });
  });
});
