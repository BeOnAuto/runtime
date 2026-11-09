import { nestedRunId } from '@on.auto/definitions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';

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
