import { describe, expect, it } from 'vitest';

import {
  DispatchFailed,
  dispatchedThrough,
  outputsAbove,
  stateFormat,
  type PositionedEvent,
  type RunOutput,
} from '../index.ts';
import { at, runId, openCall } from '../testing/runs.ts';

const arm: RunOutput = {
  kind: 'arm_timer',
  runId,
  timerId: '1',
  dueAt: at + 60_000,
  purpose: 'timeout',
};

const start: RunOutput = {
  kind: 'start_call',
  key: openCall,
  function: 'runDefinition',
  arguments: {},
  longestMs: 600,
};

const settle: RunOutput = { kind: 'settle', runId, settlement: { status: 'failed' } };

function applied(version: number, outputs: readonly RunOutput[]): PositionedEvent {
  return {
    version,
    event: {
      type: 'input_applied',
      format: stateFormat,
      receipt: { kind: 'timer_fired', key: 'k', at },
      steps: [],
      patch: [],
      outputs,
    },
  };
}

const events = [applied(3, [settle]), applied(1, [start]), applied(2, [arm, start]), applied(4, [])];

describe('the outputs above a watermark', () => {
  it('are those of the events after it, in the order of the stream', () => {
    expect(outputsAbove(1, events)).toEqual([
      { version: 2, output: arm },
      { version: 2, output: start },
      { version: 3, output: settle },
    ]);
    expect(outputsAbove(4, events)).toEqual([]);
  });
});

describe('the watermark after a dispatch', () => {
  it('moves to the last event when every output was dispatched, even past events with none', () => {
    expect(dispatchedThrough(1, events)).toBe(4);
  });

  it('stops before the event of the first output that failed, so the next wake starts there', () => {
    expect(dispatchedThrough(1, events, 3)).toBe(2);
    expect(dispatchedThrough(1, events, 2)).toBe(1);
  });

  it('never goes down', () => {
    expect([dispatchedThrough(3, events, 2), dispatchedThrough(5, events), dispatchedThrough(2, [])]).toEqual([
      3, 5, 2,
    ]);
  });
});

describe('a failed dispatch', () => {
  it('names the kind of output that could not be dispatched', () => {
    expect(new DispatchFailed({ output: 'settle', detail: 'the record store did not answer' })).toMatchObject({
      _tag: 'dispatch_failed',
      output: 'settle',
    });
  });
});
