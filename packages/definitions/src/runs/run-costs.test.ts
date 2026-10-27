import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent, modelCallTimedOut } from '../journal-testing/model-calls.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { ModelCallFact } from './run-commands.ts';

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const atTheStart = recordedWith({ runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z', ...ofGreet });

const meanwhile = recordedWith({ runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:02.000Z', ...ofGreet });

const started = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } });

const failed = meanwhile({ type: 'run_failed', data: {} });

function sent(number: number): ModelCallFact {
  return { type: 'model_call_started', data: { number, ...modelCallSent() } };
}

function answered(number: number): ModelCallFact {
  return { type: 'model_call_answered', data: { number, ...modelCallAnswered() } };
}

function timedOut(number: number, cost?: number): ModelCallFact {
  return {
    type: 'model_call_failed',
    data: { number, ...modelCallTimedOut, ...(cost === undefined ? {} : { cost_usd: cost }) },
  };
}

describe('the cost of a run', () => {
  it('holds each model call that answered a cost, by its number, kept across a start recorded again', () => {
    const state = runStateAfter([
      started,
      meanwhile(sent(1)),
      meanwhile(answered(1)),
      meanwhile(sent(2)),
      meanwhile(timedOut(2, 0.01)),
      failed,
      started,
      meanwhile(sent(3)),
      meanwhile(timedOut(3)),
    ]);

    expect(state).toMatchObject({
      costs: [
        { number: 1, cost_usd: 0.000_42 },
        { number: 2, cost_usd: 0.01 },
      ],
    });
  });

  it('is nothing before any model call answers', () => {
    expect(runStateAfter([started, meanwhile(sent(1))])).toMatchObject({ costs: [] });
  });
});
