import { nestedRunId } from '@on.auto/definitions';
import { messageIdOf } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeCaller } from '../testing/workflows.ts';
import { definitionCalls } from './function-calls.ts';
import type { DefinitionRunRequest, DefinitionRunResult } from './function-run.ts';

const workflowRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  runId: `acme/alpha/${workflowRun}`,
  attributes: {
    org: 'acme',
    playbook: 'alpha',
    run_id: workflowRun,
    definition: { name: 'triage', version: 2 },
    caller: { id: 'acme-admin', org: 'acme', permissions: ['playbook:read', 'playbook:write'], playbooks: '*' },
  },
};

function callWith(arguments_: StartCall['arguments']): StartCall {
  return {
    kind: 'start_call',
    key: { runId: run.runId, reference: '/do/0/classify', run: 1 },
    function: 'run_definition',
    arguments: arguments_,
    longestMs: 60_000,
  };
}

const classify = callWith({ type: 'reasoning', name: 'classify', input: { ticket: 7 } });

const origin = { version: 3 };

const firstAttempt = { attemptDied: false };

const waitingOfTheCall = messageIdOf(`playbook/acme/alpha/run-logs/${workflowRun}`, origin.version);

function answering(result: DefinitionRunResult) {
  const asked: DefinitionRunRequest[] = [];
  const perform = definitionCalls((request) =>
    Effect.sync(() => {
      asked.push(request);
      return result;
    }),
  );
  return { perform, asked };
}

describe('a workflow call to a saved definition', () => {
  it.each(['reasoning', 'custom-operation'])(
    'executes a %s definition for the original caller under a derived run id',
    async (type) => {
      const { perform, asked } = answering({ status: 'succeeded', output: { urgency: 'high' } });

      const result = await Effect.runPromise(
        perform(callWith({ type, name: 'classify', input: { ticket: 7 } }), run, origin, firstAttempt),
      );

      expect(result).toEqual({ status: 'succeeded', output: { urgency: 'high' } });
      expect(asked).toEqual([
        {
          org: 'acme',
          playbook: 'alpha',
          caller: acmeCaller,
          type,
          name: 'classify',
          input: { ticket: 7 },
          runId: nestedRunId(workflowRun, '/do/0/classify', 1),
          lineage: { causationId: waitingOfTheCall, correlationId: workflowRun },
          depth: 0,
          callDepth: 1,
          calledBy: { run_id: workflowRun, reference: '/do/0/classify', run: 1 },
        },
      ]);
    },
  );

  it('starts the definition caused by the record that started its call, and belonging to the run the workflow belongs to', async () => {
    const { perform, asked } = answering({ status: 'succeeded', output: null });
    const belonging = { ...run, attributes: { ...run.attributes, lineage: { start: 'started', correlation: 'root' } } };

    await Effect.runPromise(perform(classify, belonging, origin, firstAttempt));

    expect(asked.map(({ lineage }) => lineage)).toEqual([{ causationId: waitingOfTheCall, correlationId: 'root' }]);
  });

  it('starts the definition at the reaction depth of the run that calls it', async () => {
    const { perform, asked } = answering({ status: 'succeeded', output: null });
    const reacting = { ...run, attributes: { ...run.attributes, depth: 3 } };

    await Effect.runPromise(perform(classify, reacting, origin, firstAttempt));

    expect(asked.map(({ depth }) => depth)).toEqual([3]);
  });
});

describe('a workflow call with invalid arguments', () => {
  it('executes nothing when they do not name a definition it may execute', async () => {
    const { perform, asked } = answering({ status: 'succeeded', output: null });

    const result = await Effect.runPromise(perform(callWith('classify'), run, origin, firstAttempt));

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_arguments',
      detail: 'run_definition takes with: { type, name, input }',
    });
    expect(asked).toEqual([]);
  });
});

describe('a call of a workflow whose run names no caller', () => {
  it('fails for a run that names no playbook or caller', async () => {
    const { perform } = answering({ status: 'succeeded', output: null });

    expect(await Effect.runPromise(perform(classify, { ...run, attributes: {} }, origin, firstAttempt))).toEqual({
      status: 'failed',
      detail: 'The run names no playbook and no caller to run a definition for',
    });
  });
});

describe('the answer of a definition a workflow called', () => {
  it('carries a rejection in the words of its detail, which says each issue, and its issues at their pointers', async () => {
    const issues = [{ detail: 'ticket, the number of the ticket: expected text.', pointer: '/input/ticket' }];
    const { perform } = answering({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'ticket, the number of the ticket: expected text.',
      issues,
    });

    expect(await Effect.runPromise(perform(classify, run, origin, firstAttempt))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'ticket, the number of the ticket: expected text.',
      issues,
    });
  });

  it('carries a failure, and fails an output larger than a workflow takes', async () => {
    const failed = answering({ status: 'failed', detail: 'The run failed with incident i-1' });
    const large = answering({ status: 'succeeded', output: 'x'.repeat(1_048_576) });

    expect(await Effect.runPromise(failed.perform(classify, run, origin, firstAttempt))).toEqual({
      status: 'failed',
      detail: 'The run failed with incident i-1',
    });
    expect(await Effect.runPromise(large.perform(classify, run, origin, firstAttempt))).toEqual({
      status: 'failed',
      detail: 'The run returned 1048578 bytes as JSON, more than the 1048576 a workflow takes',
    });
  });

  it('carries a rejection without issues as it is', async () => {
    const { perform } = answering({ status: 'rejected', reason: 'unavailable', detail: 'Busy' });

    expect(await Effect.runPromise(perform(classify, run, origin, firstAttempt))).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'Busy',
    });
  });
});

describe('a call whose definition is rejected with a kind and because', () => {
  it('carries the kind and because of a rejection', async () => {
    const { perform } = answering({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No tool server of that name',
      kind: 'tool_not_offered',
      because: 'tool_server_not_configured',
    });

    expect(await Effect.runPromise(perform(classify, run, origin, firstAttempt))).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No tool server of that name',
      kind: 'tool_not_offered',
      because: 'tool_server_not_configured',
    });
  });
});
