import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import type { RecordedRunEvent } from '../runs/run-events.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { firstMoment } from '../testing/harness.ts';
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
      waitedMs: 0,
      requests: 0,
      waiting: null,
    });
  });
});

const request = {
  to: 'person:user_7kLm2',
  message: 'Approve?',
  expires_at: '2026-10-01T09:10:00.000Z',
  requested_at: firstMoment,
};

const deferredAt = (at: string) =>
  recordedWith({ ...context, at })({ type: 'run_deferred', data: { record: request } });

const answeredAt = (at: string) =>
  recordedWith({ ...context, at })({
    type: 'request_answered',
    data: { answer: { approved: true }, answered_by: { id: 'person:user_7kLm2', name: 'Priya' } },
  });

const resumedAt = (at: string, attempt: number) =>
  recordedWith({ ...context, at })({ type: 'attempt_resumed', data: { attempt } });

describe('the requests a run waited on, folded from its stream', () => {
  it('holds the request the run went on from, with its answer, and the time it waited, added up over its waits', () => {
    const folded = foldedOf([
      started,
      deferredAt('2026-10-01T09:00:01.000Z'),
      answeredAt('2026-10-01T09:00:30.000Z'),
      resumedAt('2026-10-01T09:00:31.000Z', 2),
      deferredAt('2026-10-01T09:01:00.000Z'),
      resumedAt('2026-10-01T09:03:00.000Z', 3),
    ]);

    expect(folded).toMatchObject({
      waitedMs: 30_000 + 120_000,
      requests: 2,
      waiting: null,
      request: { record: request, at: '2026-10-01T09:01:00.000Z', answer: null },
    });
  });

  it('keeps the answer of the request the run waits on, until the run goes on from it', () => {
    const folded = foldedOf([started, deferredAt('2026-10-01T09:00:01.000Z'), answeredAt('2026-10-01T09:00:30.000Z')]);

    expect(folded).toMatchObject({
      requests: 1,
      waitedMs: 0,
      waiting: { record: request, answer: { answer: { approved: true }, at: '2026-10-01T09:00:30.000Z' } },
    });
    expect(folded).not.toHaveProperty('request');
  });
});

describe('the requests of a run that waits on none, folded from its stream', () => {
  it('takes no answer and no going on outside a wait, as a run that resumes after its server stopped does', () => {
    const folded = foldedOf([
      started,
      answeredAt('2026-10-01T09:00:30.000Z'),
      resumedAt('2026-10-01T09:05:00.000Z', 2),
    ]);

    expect(folded).toMatchObject({ requests: 0, waitedMs: 0, waiting: null });
    expect(folded).not.toHaveProperty('request');
  });

  it('starts again with a run started again under its id', () => {
    const folded = foldedOf([
      started,
      deferredAt('2026-10-01T09:00:01.000Z'),
      resumedAt('2026-10-01T09:00:31.000Z', 2),
      startedAgain,
    ]);

    expect(folded).toMatchObject({ requests: 0, waitedMs: 0, waiting: null });
    expect(folded).not.toHaveProperty('request');
  });
});
