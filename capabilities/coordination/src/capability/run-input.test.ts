import { memoryLedger } from '@on.auto/operations/testing';
import type { Json } from '@on.auto/workflow-engine';
import { HostElsewhere } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testExpressionCheck } from '../testing/expression-checks.ts';
import { playbookOn } from '../testing/playbook.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { makeWorkflowAdapter, type WorkflowAdapterDependencies } from './workflow.ts';

const neverStarted: WorkflowAdapterDependencies = {
  runs: { start: () => Effect.die('A workflow started') },
  check: testExpressionCheck,
  mostDurationMs: 30 * 24 * 3_600_000,
  longestCallMs: 660_000,
  names: testPlaybookNames,
};

const flow = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n`;

function nested(depth: number): Json {
  return depth === 0 ? 'bottom' : [nested(depth - 1)];
}

async function running(input: Json) {
  const playbook = playbookOn(memoryLedger(), [makeWorkflowAdapter(neverStarted)]);
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });
  return playbook.call(playbook.runDefinition, { type: 'workflow', name: 'flow', input });
}

describe('running a workflow definition with an input a workflow may not hold', () => {
  it('is rejected for an input that nests more than 512 levels deep, before a workflow starts', async () => {
    expect(await running({ deep: nested(512) })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ detail: 'Expected an input that nests at most 512 levels deep', pointer: '/input' }],
    });
  });

  it('checks its document against the most a workflow may run that it was set with', async () => {
    const playbook = playbookOn(memoryLedger(), [makeWorkflowAdapter({ ...neverStarted, mostDurationMs: 10_800_000 })]);
    const source = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: [{ pause: { wait: PT4H } }]\n`;

    expect(await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source })).toMatchObject({
      status: 'rejected',
      issues: [
        {
          detail:
            'Line 2, column 23: at /do/0/pause/wait: This duration, 14400000 ms, is longer than the 10800000 ms a workflow may run',
        },
      ],
    });
  });

  it('starts a workflow for an input that nests 512 levels deep', async () => {
    expect(await running({ deep: nested(511) })).toMatchObject({ status: 'failed' });
  });
});

describe('running a workflow definition while another server runs the workflows of the database', () => {
  it('is rejected as unavailable with the words of the host', async () => {
    const detail = 'The workflows of this database run in another server';
    const elsewhere = makeWorkflowAdapter({
      ...neverStarted,
      runs: { start: () => Effect.fail(new HostElsewhere({ detail })) },
    });
    const playbook = playbookOn(memoryLedger(), [elsewhere]);
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });

    expect(await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'flow' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail,
    });
  });
});

describe('the workflow wording', () => {
  const workflow = makeWorkflowAdapter(neverStarted);

  it('calls a definition a workflow', () => {
    expect(workflow.noun).toEqual({ one: 'workflow', other: 'workflows' });
  });

  it('renders a small result, and points to the details for a large one', () => {
    expect([
      workflow.describeOutput({ greeting: 'Hello, Ada.', reply: 'Thank you!' }),
      workflow.describeOutput({ text: 'a'.repeat(400) }),
    ]).toEqual([
      'Its result: greeting: “Hello, Ada.” and reply: “Thank you!”',
      'Its result is too long to repeat here; the whole of it is in the details below.',
    ]);
  });
});
