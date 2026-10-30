import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';

let playbook: WorkflowPlaybook;

const flow = `document:
  dsl: '1.0.3'
  namespace: acme
  name: slow-greeting
  version: '1.0.0'
do:
  - pause: { wait: { milliseconds: 200 } }
  - greet:
      call: run_definition
      with: { type: echo, name: greet, input: { name: '\${ $data.name }' } }
`;

const failing = `document:
  dsl: '1.0.3'
  namespace: acme
  name: failing
  version: '1.0.0'
do:
  - stop:
      raise:
        error: { type: https://example.com/busy, status: 503, title: Busy }
`;

beforeAll(async () => {
  playbook = await workflowPlaybook();
  await playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'slow-greeting', source: flow });
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'failing', source: failing });
});

afterAll(async () => {
  await playbook.close();
});

const runId = '0199a3c4-7d2e-7c1a-9b3f-3333333333a1';

function running(name = 'slow-greeting', id = runId) {
  return playbook.call(playbook.runDefinition, {
    type: 'workflow',
    name,
    input: { name: 'Grace' },
    run_id: id,
  });
}

describe('running a workflow definition', () => {
  it('starts its run and answers started, recording that it finishes later', async () => {
    expect(await running()).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'started' },
    });
    expect(await playbook.call(playbook.getRun, { run_id: runId })).toMatchObject({
      output: { status: 'started', record: {} },
    });
  });

  it('answers the run as it stands when the call is retried while the run goes on', async () => {
    expect(await running()).toMatchObject({ output: { status: 'started' } });
  });

  it('is settled with the output when the run ends, which a retry then answers', async () => {
    const settled = {
      status: 'succeeded',
      output: { status: 'succeeded', output: { greeting: 'Hello', input: { name: 'Grace' } } },
    };

    expect(await playbook.settled(runId)).toMatchObject(settled);
    expect(await running()).toMatchObject(settled);
  });
});

describe('running again a workflow whose run ended without a final result', () => {
  it('is rejected as a conflict, since a workflow runs once for a run ID, and the rejection is recorded', async () => {
    const failed = '0199a3c4-7d2e-7c1a-9b3f-3333333333a2';
    await running('failing', failed);
    const ended = await playbook.settled(failed);

    expect(ended).toMatchObject({ output: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    expect(await running('failing', failed)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'This run ID already ran its workflow, which ended; a workflow runs once for a run ID, so use a new run ID to run it again',
    });
  });
});

describe('running a workflow definition while the server stops', () => {
  it('is rejected as unavailable, and the rejection is recorded', async () => {
    const stopping = await workflowPlaybook();
    await stopping.call(stopping.createDefinition, { type: 'workflow', name: 'failing', source: failing });
    await stopping.close();
    const id = '0199a3c4-7d2e-7c1a-9b3f-3333333333a3';

    const outcome = await stopping.call(stopping.runDefinition, {
      type: 'workflow',
      name: 'failing',
      run_id: id,
    });

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The workflow cannot start now; try again shortly',
    });
    expect(await stopping.call(stopping.getRun, { run_id: id })).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unavailable' } },
    });
  });
});
