import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { runStartedOf } from './run-starts.ts';

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: 'run-1',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 3,
};

describe('the start of a run read from its record', () => {
  it('is the context of the start, and nothing for any other record or a start without its definition', () => {
    const { definitionName: _name, ...withoutItsDefinition } = context;

    expect([
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: { ...context, depth: 2 },
      }),
      runStartedOf({ type: 'run_failed', data: {}, context }),
      runStartedOf({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } }),
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: withoutItsDefinition,
      }),
      runStartedOf('not a record'),
    ]).toEqual([{ ...context, depth: 2 }, undefined, undefined, undefined, undefined]);
  });
});
