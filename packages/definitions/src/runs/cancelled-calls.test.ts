import { RunCancelled } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { CallFact, ModelCallFact, RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RecordedRunEvent } from './run-events.ts';

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const atTheStart = recordedWith({ runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z', ...ofGreet });

const during = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:02.000Z' };

const meanwhile = recordedWith({ ...during, ...ofGreet });

function decided(fact: CallFact, ...history: readonly RecordedRunEvent[]) {
  const command: RunCommand = { type: 'call', fact, ...during };
  return runDecider.decide(command, runStateAfter(history));
}

const input = { who: 'Ada' };

const startedToResume = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input, resumes: true } });

const startedInItsCall = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input } });

const cancelAsked = meanwhile({ type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed' } });

const cancelledAsAsked = new RunCancelled({ detail: 'Not needed', kind: 'requested' });

const modelCallStarted = (number: number): ModelCallFact => ({
  type: 'model_call_started',
  data: { number, ...modelCallSent() },
});

const modelCallEnded: ModelCallFact = { type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } };

const toolCallStarted: CallFact = {
  type: 'tool_call_started',
  data: { call_id: 'toolu_01', server: 'graph', tool: 'search', arguments_bytes: 17 },
};

describe('a call of a run that resumes, once its cancel was recorded', () => {
  it('starts nothing more, refused as cancelled, while an end of a call it started is still taken', () => {
    const modelCallMade = meanwhile(modelCallStarted(1));

    expect([
      decided(modelCallStarted(2), startedToResume, modelCallMade, meanwhile(modelCallEnded), cancelAsked),
      decided(toolCallStarted, startedToResume, cancelAsked),
      decided(modelCallEnded, startedToResume, modelCallMade, cancelAsked),
      decided(toolCallStarted, startedInItsCall, cancelAsked),
    ]).toEqual([
      Result.fail(cancelledAsAsked),
      Result.fail(cancelledAsAsked),
      Result.succeed([modelCallEnded]),
      Result.succeed([{ type: 'tool_call_started', data: { ...toolCallStarted.data, number: 1 } }]),
    ]);
  });
});
