import { nestedRunId } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { childRunOf } from './child-run.ts';

const workflowRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const call = {
  function: 'run_definition',
  reference: '/do/0/classify',
  run: 2,
  arguments: { type: 'reasoning', name: 'classify', input: {} },
  attributes: { run_id: workflowRun },
};

describe('the run a call of a workflow starts', () => {
  it('is the run derived from the workflow, the reference and the run of the call, as its call will start', () => {
    expect(childRunOf(call)).toBe(nestedRunId(workflowRun, '/do/0/classify', 2));
  });

  it('is the run of a workflow the call starts, derived the same way', () => {
    expect(childRunOf({ ...call, arguments: { type: 'workflow', name: 'other' } })).toBe(
      nestedRunId(workflowRun, '/do/0/classify', 2),
    );
  });

  it('is none for arguments the call would refuse, another function, or a run whose attributes name no run', () => {
    expect([
      childRunOf({ ...call, arguments: 'plain' }),
      childRunOf({ ...call, function: 'notify' }),
      childRunOf({ ...call, attributes: {} }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
