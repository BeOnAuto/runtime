import { describe, expect, it } from 'vitest';

import { callKeyText, clampedAt, inputTimeOf, receiptOf, type RunInput } from '../index.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import { armedTimer, at, runId, openCall, runningState, started } from '../testing/runs.ts';

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', runId, at, timerId: armedTimer },
  { kind: 'call_answered', runId, at, key: openCall, result: { status: 'failed', detail: 'boom' } },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'no',
      kind: 'tool_not_offered',
      because: 'tool_not_allowed',
    },
  },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no', kind: 'tools_called' },
  },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no' },
  },
  { kind: 'event_received', runId, at, event: { id: 'event-9', type: 'com.acme.approval' } },
  { kind: 'cancel_requested', runId, at, cancel: testCancel },
];

describe('the receipt of an input', () => {
  it('names the input by the key it is deduplicated by, with the status of an answer, the kind and because of a rejection, or the type of an event', () => {
    expect(inputs.map((input) => receiptOf(input, at))).toEqual([
      { kind: 'started', key: runId, at },
      { kind: 'timer_fired', key: armedTimer, at },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'failed' },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tool_not_offered', because: 'tool_not_allowed' },
      },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tools_called' },
      },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'rejected' },
      { kind: 'event_received', key: 'event-9', at, eventType: 'com.acme.approval' },
      { kind: 'cancel_requested', key: runId, at, cancel: { by: 'tester', kind: 'requested' } },
    ]);
  });
});

describe('the time of an input', () => {
  it('never goes back: an input whose clock is behind the last input takes the time of that input', () => {
    const later = { ...runningState, lastInputAt: at + 5000 };

    expect(inputTimeOf(later, started)).toBe(at + 5000);
    expect(inputTimeOf(runningState, { kind: 'cancel_requested', runId, at: at + 1, cancel: testCancel })).toBe(at + 1);
    expect([clampedAt(at, at - 1), clampedAt(at, at + 1)]).toEqual([at, at + 1]);
  });

  it('is never before the time a fired timer was due, so a timer that fires early still fires at its time', () => {
    const early: RunInput = { kind: 'timer_fired', runId, at, timerId: armedTimer };
    const unknown: RunInput = { kind: 'timer_fired', runId, at, timerId: '9' };

    expect([inputTimeOf(runningState, early), inputTimeOf(runningState, unknown)]).toEqual([at + 60_000, at]);
  });
});
