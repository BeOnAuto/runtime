import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { handCallDecider, handCalls } from './hand-call-decider.ts';
import type { HandCallEvent } from './hand-call-events.ts';

const callId = '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b';

const context = { by: 'acme-builder', at: '2026-10-08T09:00:00.000Z' };

const started = handCalls.started({
  call_id: callId,
  server: 'graph',
  tool: 'search',
  arguments_bytes: 2,
  arguments_sha256: 'a',
});

const answered = handCalls.ended({
  type: 'tool_call_answered',
  data: { is_error: false, result_bytes: 61, result_sha256: 'b', duration_ms: 3, jsonrpc_id: 2 },
});

const failed = handCalls.ended({
  type: 'tool_call_failed',
  data: { because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 3 },
});

const outOfTurn = {
  failure: {
    _tag: 'conflict',
    detail: 'A call made by hand records its start once and then how it ended once, so this is not recorded',
  },
};

function after(...events: readonly HandCallEvent[]) {
  return events.reduce(
    (state, event) => handCallDecider.evolve(state, { ...event, context }),
    handCallDecider.initialState,
  );
}

describe('the record of a call made by hand', () => {
  it('is the facts of a call of a run, with the call id of the start and no number', () => {
    expect([started, answered, failed]).toEqual([
      {
        type: 'tool_call_started',
        data: { call_id: callId, server: 'graph', tool: 'search', arguments_bytes: 2, arguments_sha256: 'a' },
      },
      {
        type: 'tool_call_answered',
        data: { is_error: false, result_bytes: 61, result_sha256: 'b', duration_ms: 3, jsonrpc_id: 2 },
      },
      { type: 'tool_call_failed', data: { because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 3 } },
    ]);
  });

  it('takes a start, and then an answer or a failure', () => {
    expect(handCallDecider.decide({ event: started, context }, after())).toEqual(Result.succeed([started]));
    expect(handCallDecider.decide({ event: answered, context }, after(started))).toEqual(Result.succeed([answered]));
    expect(handCallDecider.decide({ event: failed, context }, after(started))).toEqual(Result.succeed([failed]));
    expect(handCallDecider.context({ event: failed, context }, after(started))).toEqual(context);
  });

  it('refuses an end before the start, a second start and a second end', () => {
    expect(handCallDecider.decide({ event: answered, context }, after())).toMatchObject(outOfTurn);
    expect(handCallDecider.decide({ event: started, context }, after(started))).toMatchObject(outOfTurn);
    expect(handCallDecider.decide({ event: failed, context }, after(started, answered))).toMatchObject(outOfTurn);
  });
});
