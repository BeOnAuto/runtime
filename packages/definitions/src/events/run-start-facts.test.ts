import type { Context, RecordedEvent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { testRunId as runId } from '../testing/run-facts.ts';
import { playbookFactOf } from './playbook-facts.ts';

const ofCheck: Context = {
  by: 'playbook:alpha',
  at: '2026-10-01T09:00:05.000Z',
  runId,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
};

const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

function ofRun(event: RunEvent, context: Context): RecordedEvent {
  return {
    id: 'record-1',
    cursor: 'record-1',
    causationId: null,
    correlationId: null,
    stream: runStreamNameOf(runId),
    version: 2,
    globalPosition: 2,
    type: event.type,
    data: event.data,
    context,
    recordedAt: ofCheck.at,
  };
}

function attributesOf(event: RunEvent, context: Context) {
  const fact = playbookFactOf(ofRun(event, context));
  return { calledby: fact?.['calledby'], calldepth: fact?.['calldepth'], data: fact?.data };
}

describe('the facts of a run that answers a call of another run', () => {
  it('name the run that called it as an attribute, and its ending the reason and kind it was rejected with as data', () => {
    const called = { ...ofCheck, calledBy, callDepth: 1 };

    expect([
      attributesOf({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } }, called),
      attributesOf(
        {
          type: 'run_rejected',
          data: { rejection: { reason: 'cancelled', detail: 'Out of time', kind: 'deadline' } },
        },
        called,
      ),
    ]).toEqual([
      { calledby: calledBy.runId, calldepth: 1, data: undefined },
      { calledby: calledBy.runId, calldepth: 1, data: { reason: 'cancelled', kind: 'deadline' } },
    ]);
  });
});

describe('the facts of a run a trigger started', () => {
  it('name the trigger, by its kind and its place in the document, on the start and on the ending', () => {
    const triggered = { ...ofCheck, trigger: { kind: 'every' as const, reference: '/schedule/every' } };

    expect(
      [
        playbookFactOf(ofRun({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } }, triggered)),
        playbookFactOf(ofRun({ type: 'run_failed', data: {} }, triggered)),
      ].map((fact) => [fact?.['triggerkind'], fact?.['triggerreference']]),
    ).toEqual([
      ['every', '/schedule/every'],
      ['every', '/schedule/every'],
    ]);
  });
});
