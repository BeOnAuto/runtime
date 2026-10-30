import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent, modelCallTimedOut } from '../journal-testing/model-calls.ts';
import { declaredFactsOf } from '../run-work/declared-facts.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { evolveRun, startedRunOf } from '../runs/run-state.ts';
import { asking } from '../testing/asking.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, testRunId } from '../testing/run-facts.ts';
import { storedTypesByStatus } from './run-status.ts';

const recorded = recordedWith({
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:00.000Z',
  definitionType: 'asking',
  definitionName: 'approve',
  definitionVersion: 1,
});

const start: RunEvent = { type: 'run_started', data: { started_by: recordedAdmin, input: {} } };

const ofTheTool = { server: 'chat', tool: 'post_message' };

const latestOfEveryType: Readonly<Record<string, RunEvent>> = {
  run_started: start,
  run_deferred: { type: 'run_deferred', data: { record: {} } },
  attempt_resumed: { type: 'attempt_resumed', data: { attempt: 2 } },
  run_succeeded: { type: 'run_succeeded', data: { output: null, record: {} } },
  run_rejected: { type: 'run_rejected', data: { rejection: { reason: 'conflict', detail: 'x' } } },
  run_failed: { type: 'run_failed', data: {} },
  run_cancel_requested: { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed' } },
  tool_call_started: {
    type: 'tool_call_started',
    data: {
      number: 1,
      call_id: 'toolu_01',
      ...ofTheTool,
      arguments_bytes: 2,
      arguments_sha256: 'a'.repeat(64),
    },
  },
  tool_call_answered: {
    type: 'tool_call_answered',
    data: {
      number: 1,
      is_error: false,
      result_bytes: 2,
      result_sha256: 'b'.repeat(64),
      duration_ms: 5,
      jsonrpc_id: 1,
    },
  },
  tool_call_failed: {
    type: 'tool_call_failed',
    data: { number: 1, because: 'timed_out', duration_ms: 5, jsonrpc_id: 1 },
  },
  model_call_started: { type: 'model_call_started', data: { number: 1, ...modelCallSent() } },
  model_call_answered: { type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } },
  model_call_failed: { type: 'model_call_failed', data: { number: 1, ...modelCallTimedOut } },
  request_answered: { type: 'request_answered', data: { answered_by: recordedAdmin, answer: { choice: 'approve' } } },
  nudge_sent: { type: 'work', data: { fact: { type: 'nudge_sent', data: { number: 1 } } } },
};

const byStatus = storedTypesByStatus(declaredFactsOf([asking]));

const statusByStoredType = Object.entries(byStatus).flatMap(([status, types]: readonly [string, readonly string[]]) =>
  types.map((type) => [type, status] as const),
);

function statusAfter(type: string): string | undefined {
  const latest = latestOfEveryType[type];
  const started = evolveRun(undefined, recorded(start));
  return latest === undefined ? undefined : startedRunOf(evolveRun(started, recorded(latest)))?.run.status;
}

describe('the stored types of a status', () => {
  it('name every fact of a run once, those the capabilities of the playbook declare among them', () => {
    expect(statusByStoredType.map(([type]) => type).toSorted()).toEqual(Object.keys(latestOfEveryType).toSorted());
  });

  it.each(statusByStoredType)('give a run whose latest fact is %s the status %s', (type, status) => {
    expect(statusAfter(type)).toBe(status);
  });
});
