import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import type { RecordedRunEvent } from '../runs/run-events.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { recordedOnTheRun, recordedWith, testRunId } from '../testing/run-facts.ts';
import { recordedAttempt } from './recorded-attempt.ts';

const context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:00.000Z',
  definitionType: 'tool-user',
  definitionName: 'caller',
  definitionVersion: 1,
};

const started = recordedWith(context)({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } });

const startedAgain = recordedWith({ ...context, at: '2026-10-01T09:05:00.000Z' })({
  type: 'run_started',
  data: { started_by: recordedAdmin, input: {} },
});

const failed = recordedWith(context)({ type: 'run_failed', data: {} });

const answered = recordedOnTheRun({ type: 'model_call_answered', data: { number: 1, ...modelCallAnswered(0) } });

const firstCall = recordedOnTheRun({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } });

const secondCall = recordedOnTheRun(
  { type: 'model_call_started', data: { number: 2, ...modelCallSent() } },
  '2026-10-01T09:05:01.000Z',
);

function foldedOf(events: readonly RecordedRunEvent[]) {
  return events.reduce((attempt, event) => recordedAttempt.evolve(attempt, event), recordedAttempt.initialState);
}

describe('the attempt a run goes on from, folded from its stream', () => {
  it('holds the calls since its latest start, after the model calls of the attempts before it', () => {
    expect(foldedOf([started, firstCall, answered, failed, startedAgain, secondCall])).toEqual({
      startedAt: '2026-10-01T09:05:00.000Z',
      modelCallsBefore: 1,
      lastModelCall: 2,
      calls: [secondCall],
    });
  });
});
