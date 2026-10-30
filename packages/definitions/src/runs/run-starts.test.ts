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
  it('is the context of the start, and nothing for any other record', () => {
    expect([
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: { ...context, depth: 2 },
      }),
      runStartedOf({ type: 'run_failed', data: {}, context }),
      runStartedOf(null),
      runStartedOf('not a record'),
    ]).toEqual([{ ...context, depth: 2 }, undefined, undefined, undefined]);
  });

  it('is refused, as any unreadable fact of the run, when the start is in a shape the run does not read', () => {
    const { definitionName: _name, ...withoutItsDefinition } = context;

    expect(() =>
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: withoutItsDefinition,
      }),
    ).toThrow('Missing key');
    expect(() => runStartedOf({ type: 'run_started', data: { input: {} }, context })).toThrow('Missing key');
  });
});
