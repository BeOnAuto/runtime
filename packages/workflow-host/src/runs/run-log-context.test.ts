import { describe, expect, it } from 'vitest';

import { runLogContextOf } from './run-log-context.ts';

const at = '2026-10-01T09:00:00.000Z';

const attributes = {
  org: 'acme',
  playbook: 'alpha',
  run_id: 'r-1',
  definition: { name: 'close', version: 2 },
  caller: { id: 'acme-admin', org: 'acme', permissions: [], playbooks: '*' },
  depth: 0,
  call_depth: 0,
};

describe('the context of the records of a workflow run', () => {
  it('names the run, its workflow and version, and the caller it acts as, with no chain at the top', () => {
    expect(runLogContextOf(attributes, at)).toEqual({
      at,
      by: 'acme-admin',
      runId: 'r-1',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 2,
    });
  });

  it('carries the call that started the run, its depths and the trigger that started it', () => {
    const chained = {
      ...attributes,
      depth: 2,
      call_depth: 1,
      called_by: { run_id: 'r-0', reference: '/do/0/check', run: 1 },
      trigger: { kind: 'event', reference: '/schedule/on' },
    };

    expect(runLogContextOf(chained, at)).toMatchObject({
      calledBy: { runId: 'r-0', reference: '/do/0/check', run: 1 },
      callDepth: 1,
      depth: 2,
      trigger: { kind: 'event', reference: '/schedule/on' },
    });
  });

  it('fails as a defect on attributes it cannot read, which the host never writes', () => {
    expect(() => runLogContextOf({ definition: 'close' }, at)).toThrow('run_id');
  });
});
