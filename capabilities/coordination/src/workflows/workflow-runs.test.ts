import { startedAt as workflowStartedAt } from '@on.auto/workflow-engine/testing';
import { describe, expect, it } from 'vitest';

import { runId, interpret, workflow } from '../testing/workflows.ts';

const greeting = workflow(`
do:
  - greet:
      set:
        greeting: \${ "Hello, " + $data.name }
`);

const pausing = workflow(`
do:
  - pause:
      wait: PT1H
`);

describe('a workflow run that succeeds', () => {
  it('runs its tasks on the input, settles the run with the output and completes with it', async () => {
    const { ending, commands } = await interpret(greeting, { input: { name: 'Ada' } });

    expect(ending).toEqual({ kind: 'completed', output: { greeting: 'Hello, Ada' } });
    expect(commands.filter(({ kind }) => kind !== 'deadline')).toEqual([
      {
        kind: 'settle',
        request: {
          org: 'acme',
          playbook: 'alpha',
          definition: 'test-flow',
          runId,
          settlement: { status: 'succeeded', output: { greeting: 'Hello, Ada' } },
        },
      },
    ]);
  });
});

describe('the data of a workflow', () => {
  it('is shaped by input.from and output.as', async () => {
    const document = workflow(`
input:
  from: '\${ ({ name: $data.person.first }) }'
do:
  - greet:
      set:
        greeting: \${ "Hello, " + $data.name }
output:
  as: $data.greeting
`);

    expect((await interpret(document, { input: { person: { first: 'Grace' } } })).ending).toEqual({
      kind: 'completed',
      output: 'Hello, Grace',
    });
  });

  it('describes the workflow and the runtime to the expressions of its input', async () => {
    const document = workflow(`
input:
  from: '\${ ({ id: $workflow.id, at: $workflow.startedAt.iso8601, runtime: $runtime.name }) }'
do: []
`);

    expect((await interpret(document, { input: 7 })).ending).toEqual({
      kind: 'completed',
      output: { id: runId, at: new Date(workflowStartedAt).toISOString(), runtime: 'auto-runtime' },
    });
  });
});

describe('a workflow run that raises an error it does not catch', () => {
  it('is rejected as invalid input, and fails, for a client error', async () => {
    const document = workflow(`
do:
  - reject:
      raise:
        error:
          type: https://example.com/errors/no-name
          status: 422
          title: The input names no one
`);

    const { ending, settlement } = await interpret(document);

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input names no one, at the step reject.',
    });
    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'The input names no one, at the step reject.',
    });
  });

  it('rejects a document the policy forbids, even one that was never parsed', async () => {
    const document = workflow('do:\n  - shell:\n      run:\n        shell:\n          command: ls');

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The workflow document is not allowed by this runtime: /do/0/shell/run: run tasks (shell, script, container, workflow) are not allowed.',
    });
  });
});

describe('a workflow run whose output is too large', () => {
  it('ends rejected as a conflict of the kind oversized, naming the limit', async () => {
    const document = workflow('do:\n  - grow:\n      set: ${ $data.big }');

    const { ending, settlement } = await interpret(document, { input: { big: 'x'.repeat(1_100_000) } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'oversized',
      detail: 'The output of the workflow takes 1100002 bytes as JSON, more than the 1048574 a run records',
    });
    expect(ending).toEqual({
      kind: 'failed',
      type: 'WorkflowOutputTooLarge',
      message: "The workflow's output takes 1100002 bytes as JSON, more than the 1048574 a run records",
    });
  });
});

describe('a workflow run that is cancelled', () => {
  it('ends rejected as cancelled, with who asked and why', async () => {
    const { ending, settlement } = await interpret(pausing, {
      started: (_start, fake) => {
        fake.at(1000, () => {
          fake.cancelWorkflow();
        });
      },
    });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'The test cancelled the run',
      by: 'tester',
    });
    expect(ending.kind).toBe('cancelled');
  });

  it('cancels the work it runs at once', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - left: { wait: PT1H }
          - right: { wait: PT2H, timeout: { after: PT3H } }
`);

    const { commands } = await interpret(document, {
      started: (_start, fake) => {
        fake.at(1000, () => {
          fake.cancelWorkflow();
        });
      },
    });

    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/both/fork/branches/1/right' });
  });
});
