import { describe, expect, it } from 'vitest';

import { cancelRequestOf, lastEndingOf, runEndingOf } from '../index.ts';
import { recordedAdmin } from '../testing/callers.ts';

const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '0199a3c4-7d2e-7c1a-9b3f-000000000002',
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy,
};

const started = { type: 'run_started', data: { started_by: recordedAdmin, input: {} }, context };

const succeeded = { type: 'run_succeeded', data: { output: 'done', record: {} }, context };

const cancelAsked = { type: 'run_cancel_requested', data: { kind: 'deadline', reason: 'Out' }, context };

describe('the ending of a run, read from its record', () => {
  it('is a success, a rejection or a failure with the call it answers in its context, and nothing for any other record', () => {
    expect([runEndingOf(succeeded), runEndingOf(started), runEndingOf({ type: 'nonsense' })]).toEqual([
      succeeded,
      undefined,
      undefined,
    ]);
  });

  it('is the last record of a run that ended, and nothing for a run still going', () => {
    expect([lastEndingOf([started, succeeded]), lastEndingOf([started, succeeded, started]), lastEndingOf([])]).toEqual(
      [succeeded, undefined, undefined],
    );
  });
});

describe('a cancel request, read from its record', () => {
  it('is the request with its kind and reason, who asked, when and of which run, and nothing for any other record', () => {
    const { at, by, runId } = context;

    expect([cancelRequestOf(cancelAsked), cancelRequestOf(succeeded)]).toEqual([
      { ...cancelAsked, context: { at, by, runId } },
      undefined,
    ]);
  });
});
