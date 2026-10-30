import { describe, expect, it } from 'vitest';

import { newRun, outcomeOf, RunMismatch, staleReasonOf, type RunInput } from '../index.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import { armedTimer, at, document, runId, openCall, runningState, started } from '../testing/runs.ts';

const fired = (timerId: string): RunInput => ({ kind: 'timer_fired', runId, at, timerId });

const answered = (run: number): RunInput => ({
  kind: 'call_answered',
  runId,
  at,
  key: { ...openCall, run },
  result: { status: 'succeeded', output: { approved: true } },
});

const received = (id: string): RunInput => ({
  kind: 'event_received',
  runId,
  at,
  event: { id, type: 'com.acme.approval' },
});

const cancelled: RunInput = { kind: 'cancel_requested', runId, at, cancel: testCancel };

describe('an input that can still change a run', () => {
  it('is a start of a new run, the fire of an armed timer, the answer of an open call, a new event or a first cancel', () => {
    const reasons = [
      staleReasonOf(newRun, started),
      staleReasonOf(runningState, fired(armedTimer)),
      staleReasonOf(runningState, answered(1)),
      staleReasonOf(runningState, received('event-3')),
      staleReasonOf(runningState, cancelled),
    ];

    expect(reasons).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(outcomeOf()).toBe('applied');
  });
});

describe('an input to a run that has not started', () => {
  it('is not stale but too early, so the adapter answers not_found and the caller tries again', () => {
    expect(
      [fired(armedTimer), answered(1), received('event-3'), cancelled].map((input) => staleReasonOf(newRun, input)),
    ).toEqual(['not_started', 'not_started', 'not_started', 'not_started']);
    expect(outcomeOf('not_started')).toBe('not_started');
  });
});

describe('a stale input', () => {
  it('names why it can no longer change the run', () => {
    const reordered = { do: document.do, document: document.document };

    expect([
      staleReasonOf(runningState, { ...started, document: reordered }),
      staleReasonOf({ ...runningState, status: 'ended' }, answered(1)),
      staleReasonOf(runningState, fired('9')),
      staleReasonOf(runningState, answered(2)),
      staleReasonOf(runningState, received('event-1')),
      staleReasonOf({ ...runningState, cancelRequested: true }, cancelled),
    ]).toEqual([
      'started_before',
      'run_ended',
      'timer_not_armed',
      'call_not_open',
      'event_received_before',
      'cancel_requested_before',
    ]);
    expect(outcomeOf('timer_not_armed')).toBe('stale');
  });
});

describe('an input that belongs to no run like this one', () => {
  it('dies instead of being taken as stale: another run, or a start with another document or input', () => {
    expect(() => staleReasonOf(runningState, { ...fired(armedTimer), runId: 'another' })).toThrow(RunMismatch);
    expect(() => staleReasonOf(runningState, { ...started, runId: 'another' })).toThrow(RunMismatch);
    expect(() => staleReasonOf(runningState, { ...started, document: { do: [{ other: {} }] } })).toThrow(
      new RunMismatch({ detail: `The run of ${runId} was started again with another document` }),
    );
    expect(() => staleReasonOf(runningState, { ...started, input: { ticket: 8 } })).toThrow(
      new RunMismatch({ detail: `The run of ${runId} was started again with another input` }),
    );
    expect(() => staleReasonOf({ ...runningState, workflow: null }, started)).toThrow(RunMismatch);
  });
});
