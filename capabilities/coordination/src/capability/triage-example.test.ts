import { nestedRunId } from '@on.auto/definitions';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import type { DefinitionCall, DefinitionCallResult } from '../testing/run-terms.ts';
import { testWorkflowPolicy } from '../testing/test-sandbox.ts';
import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';
import { interpret, workflowExample, yamlObject } from '../testing/workflows.ts';

let playbook: WorkflowPlaybook;

const greeting = `document:
  dsl: '1.0.3'
  namespace: acme
  name: greeting
  version: '1.0.0'
do:
  - greet:
      call: run_definition
      with: { type: echo, name: greet, input: { name: Grace } }
`;

const runId = '0199a3c4-7d2e-7c1a-9b3f-3333333333b1';

beforeAll(async () => {
  playbook = await workflowPlaybook();
  await playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'greeting', source: greeting });
  await playbook.call(playbook.pauseDefinition, { type: 'echo', name: 'greet' });
});

afterAll(async () => {
  await playbook.close();
});

describe('a workflow whose step calls a function that is paused', () => {
  it('is rejected by its step, and its run names the step, the run it started and that the function is paused', async () => {
    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'greeting', run_id: runId });

    expect(await playbook.settled(runId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          cause: {
            step: 'do/0/greet',
            run_id: nestedRunId(runId, '/do/0/greet', 1),
            status: 'rejected',
            reason: 'conflict',
            kind: 'paused',
          },
        },
      },
    });
  });
});

const example = yamlObject(workflowExample);

function triagedAs(urgency: string): (call: DefinitionCall) => DefinitionCallResult {
  return ({ name }) =>
    name === 'classify-ticket'
      ? { status: 'succeeded', output: { category: 'billing', urgency } }
      : { status: 'succeeded', output: 'Refund failed twice; the customer is waiting.' };
}

describe('the example of a workflow that triages a ticket', () => {
  it('stores as a valid definition document', async () => {
    await expect(Effect.runPromise(parseWorkflowDocument(workflowExample, testWorkflowPolicy))).resolves.toEqual(
      example,
    );
  });

  it('drafts a note for an urgent ticket and hands on what the approval event carried', async () => {
    const { ending } = await interpret(example, {
      input: { ticket: 'I was charged twice' },
      respond: triagedAs('high'),
      started: (start) => {
        start.deliver({ id: 'a1', type: 'com.acme.escalation.approved', data: { by: 'dana' } });
      },
    });

    expect(ending).toEqual({
      kind: 'completed',
      output: {
        ticket: 'I was charged twice',
        triage: { category: 'billing', urgency: 'high' },
        note: 'Refund failed twice; the customer is waiting.',
        approved_by: 'dana',
      },
    });
  });

  it('skips the note and the approval for a ticket that is not urgent, handing its input on', async () => {
    const { ending } = await interpret(example, { input: { ticket: 'How do I export?' }, respond: triagedAs('low') });

    expect(ending).toEqual({
      kind: 'completed',
      output: { ticket: 'How do I export?', triage: { category: 'billing', urgency: 'low' } },
    });
  });
});
