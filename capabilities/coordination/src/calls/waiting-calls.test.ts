import { nestedRunId } from '@on.auto/definitions';
import type { StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callResultOfEnding, definitionCalls } from './function-calls.ts';
import type { DefinitionRunRequest, DefinitionRunResult } from './function-run.ts';

const firstAttempt = { attemptDied: false };

const workflowRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  runId: `acme/alpha/${workflowRun}`,
  attributes: {
    org: 'acme',
    playbook: 'alpha',
    run_id: workflowRun,
    definition: { name: 'triage', version: 2 },
    caller: { id: 'acme-admin', org: 'acme', permissions: ['playbook:read', 'playbook:write'], playbooks: '*' },
    call_depth: 3,
  },
};

const review: StartCall = {
  kind: 'start_call',
  key: { runId: run.runId, reference: '/do/0/review', run: 2 },
  function: 'run_definition',
  arguments: { type: 'workflow', name: 'review', input: { ticket: 7 } },
  longestMs: 60_000,
};

const ofTheChild = {
  by: 'playbook:alpha',
  at: 'now',
  runId: 'r-review',
  definitionType: 'workflow',
  definitionName: 'review',
  definitionVersion: 1,
};

function answering(result: DefinitionRunResult) {
  const asked: DefinitionRunRequest[] = [];
  const perform = definitionCalls((request) =>
    Effect.sync(() => {
      asked.push(request);
      return result;
    }),
  );
  return { perform, asked: (): readonly DefinitionRunRequest[] => asked };
}

const refusedTicket = [{ pointer: '/input/ticket', detail: 'ticket: expected text.' }];

describe('a workflow call of a workflow', () => {
  it('starts the workflow one call deeper, naming the call it answers, and waits for its run', async () => {
    const { perform, asked } = answering({ status: 'waiting' });

    const answer = await Effect.runPromise(perform(review, run, { version: 2 }, firstAttempt));

    expect(answer).toEqual({ status: 'waiting', child: nestedRunId(workflowRun, '/do/0/review', 2) });
    expect(asked()).toMatchObject([
      {
        type: 'workflow',
        name: 'review',
        callDepth: 4,
        calledBy: { run_id: workflowRun, reference: '/do/0/review', run: 2 },
      },
    ]);
  });
});

describe('the ending of a run a step waits for', () => {
  it('answers the step with the output of a run that succeeded, unless the output is larger than a workflow takes', () => {
    expect([
      callResultOfEnding({ type: 'run_succeeded', data: { output: { done: true }, record: {} }, context: ofTheChild }),
      callResultOfEnding({
        type: 'run_succeeded',
        data: { output: 'x'.repeat(1_048_576), record: {} },
        context: ofTheChild,
      }),
    ]).toEqual([
      { status: 'succeeded', output: { done: true } },
      { status: 'failed', detail: 'The run returned 1048578 bytes as JSON, more than the 1048576 a workflow takes' },
    ]);
  });

  it('answers the step with the rejection of a run, its kind and its issues kept', () => {
    expect([
      callResultOfEnding({
        type: 'run_rejected',
        data: { rejection: { reason: 'cancelled', kind: 'deadline', detail: 'Out of time' } },
        context: ofTheChild,
      }),
      callResultOfEnding({
        type: 'run_rejected',
        data: {
          rejection: {
            reason: 'invalid_input',
            detail: 'ticket: expected text.',
            issues: refusedTicket,
          },
        },
        context: ofTheChild,
      }),
    ]).toEqual([
      { status: 'rejected', reason: 'cancelled', kind: 'deadline', detail: 'Out of time' },
      { status: 'rejected', reason: 'invalid_input', detail: 'ticket: expected text.', issues: refusedTicket },
    ]);
  });

  it('answers the step with a failure that names the incident of a run that broke down, when it has one', () => {
    expect([
      callResultOfEnding({ type: 'run_failed', data: { incident: 'i-1' }, context: ofTheChild }),
      callResultOfEnding({ type: 'run_failed', data: {}, context: ofTheChild }),
    ]).toEqual([
      { status: 'failed', detail: 'The run failed with incident i-1' },
      { status: 'failed', detail: 'The run failed' },
    ]);
  });
});
