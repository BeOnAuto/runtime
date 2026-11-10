import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import { newRun, outcomeOf, RunMismatch, staleReasonOf, type RunInput, type RunState } from '../index.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import { armedTimer, at, document, runId, openCall, runningState, started } from '../testing/runs.ts';
import type { HeldContent, HeldContents } from './held-contents.ts';

const nothing: HeldContents = new Map();

const inputText = JSON.stringify(started.input);

const keptInput = { sha256: sha256Of(inputText), bytes: inputText.length };

const keepingItsInput: RunState = {
  ...runningState,
  machine: { ...runningState.machine, values: { ...runningState.machine.values, 1: keptInput } },
};

function contentOfTheInput(content: HeldContent): HeldContents {
  return new Map([[keptInput.sha256, content]]);
}

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
      staleReasonOf(newRun, started, nothing),
      staleReasonOf(runningState, fired(armedTimer), nothing),
      staleReasonOf(runningState, answered(1), nothing),
      staleReasonOf(runningState, received('event-3'), nothing),
      staleReasonOf(runningState, cancelled, nothing),
    ];

    expect(reasons).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(outcomeOf()).toBe('applied');
  });
});

describe('an input to a run that has not started', () => {
  it('is not stale but too early, so the adapter answers not_found and the caller tries again', () => {
    expect(
      [fired(armedTimer), answered(1), received('event-3'), cancelled].map((input) =>
        staleReasonOf(newRun, input, nothing),
      ),
    ).toEqual(['not_started', 'not_started', 'not_started', 'not_started']);
    expect(outcomeOf('not_started')).toBe('not_started');
  });
});

describe('a stale input', () => {
  it('names why it can no longer change the run', () => {
    const reordered = { do: document.do, document: document.document };

    expect([
      staleReasonOf(runningState, { ...started, document: reordered }, nothing),
      staleReasonOf({ ...runningState, status: 'ended' }, answered(1), nothing),
      staleReasonOf(runningState, fired('9'), nothing),
      staleReasonOf(runningState, answered(2), nothing),
      staleReasonOf(runningState, received('event-1'), nothing),
      staleReasonOf({ ...runningState, cancelRequested: true }, cancelled, nothing),
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
    expect(() => staleReasonOf(runningState, { ...fired(armedTimer), runId: 'another' }, nothing)).toThrow(RunMismatch);
    expect(() => staleReasonOf(runningState, { ...started, runId: 'another' }, nothing)).toThrow(RunMismatch);
    expect(() => staleReasonOf(runningState, { ...started, document: { do: [{ other: {} }] } }, nothing)).toThrow(
      new RunMismatch({ detail: `The run of ${runId} was started again with another document` }),
    );
    expect(() => staleReasonOf(runningState, { ...started, input: { ticket: 8 } }, nothing)).toThrow(
      new RunMismatch({ detail: `The run of ${runId} was started again with another input` }),
    );
    expect(() => staleReasonOf({ ...runningState, workflow: null }, started, nothing)).toThrow(RunMismatch);
  });
});

describe('a second start of a run that keeps its input outside', () => {
  const read = contentOfTheInput({ kind: 'read', text: inputText });

  it('is compared with the input read back from its text', () => {
    expect(staleReasonOf(keepingItsInput, started, read)).toBe('started_before');
    expect(() => staleReasonOf(keepingItsInput, { ...started, input: { ticket: 8 } }, read)).toThrow(
      new RunMismatch({ detail: `The run of ${runId} was started again with another input` }),
    );
  });

  it('is taken as a start made before when the input is missing or erased, since nothing is left to compare', () => {
    expect([
      staleReasonOf(keepingItsInput, { ...started, input: { ticket: 8 } }, contentOfTheInput({ kind: 'missing' })),
      staleReasonOf(keepingItsInput, { ...started, input: { ticket: 8 } }, contentOfTheInput({ kind: 'erased' })),
    ]).toEqual(['started_before', 'started_before']);
  });
});
