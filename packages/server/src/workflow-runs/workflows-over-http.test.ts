import { localDeveloper } from '@on.auto/identity/testing';
import { answers, jsonResult, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const expenseReview = workflowSource(
  'expense-review',
  `do:
  - judge:
      call: run_definition
      with:
        type: reasoning
        name: verdict
        input: { expense: '\${ $data.expense }' }
      output:
        as: '\${ ({ ...$input, approve: $data.approve }) }'
  - route:
      switch:
        - approved: { when: $data.approve === true, then: describe }
        - declined: { then: decline }
  - describe:
      call: run_definition
      with:
        type: reasoning
        name: summary
        input: { text: '\${ $data.expense }' }
      output:
        as: '\${ ({ approved: true, summary: $data }) }'
      then: end
  - decline:
      set: { approved: false }
`,
);

const recovering = workflowSource(
  'recovering',
  `do:
  - attempt:
      try:
        - describe:
            call: run_definition
            with: { type: reasoning, name: summary, input: { text: 7 } }
      catch:
        errors: { with: { status: 400 } }
        do:
          - recover: { set: { recovered: true } }
`,
);

const careless = workflowSource(
  'careless',
  `do:
  - describe:
      call: run_definition
      with: { type: reasoning, name: summary, input: { text: 7 } }
`,
);

const historyOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

const typesOfTheDeclinedReview = [
  'run_started',
  'run_succeeded',
  ...Array.from({ length: 3 }, () => 'step_finished'),
  'step_waiting',
  'workflow_input_applied',
  'workflow_input_applied',
];

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function serving(...replies: readonly ScriptedReply[]): Promise<void> {
  server = await servingWorkflows(replies);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'verdict', source: verdict } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'expense-review', source: expenseReview },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'recovering', source: recovering } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'careless', source: careless } });
}

async function ran(name: string, input: object): Promise<string> {
  const response = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input } });
  expect(response).toMatchObject({ status: 200, body: { status: 'started' } });
  return runIdIn(response.body);
}

const startedLocally = { started_by: { id: 'local', name: localDeveloper.name } };

describe('a workflow that runs reasoning functions, over HTTP', () => {
  it('branches on the first answer, executes the second definition, and settles succeeded with what it composed', async () => {
    await serving(answers(jsonResult({ approve: true })), answers(textResult('Dinner for six, within policy.')));

    const runId = await ran('expense-review', { expense: 'a team dinner' });
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);

    expect(settled).toMatchObject({
      status: 200,
      body: {
        run_id: runId,
        type: 'workflow',
        name: 'expense-review',
        status: 'succeeded',
        output: { approved: true, summary: 'Dinner for six, within policy.' },
        ...startedLocally,
      },
    });
  });

  it('leaves each nested run in the ledger under its own id, run as the caller who started the workflow', async () => {
    await serving(answers(jsonResult({ approve: true })), answers(textResult('Within policy.')));

    const runId = await ran('expense-review', { expense: 'a taxi' });
    await settledRun(server, `${alpha}/runs/${runId}`);
    const nested = await Promise.all(
      server.modelRunIds().map((id) => server.call('GET', `${alpha}/runs/${String(id)}`)),
    );

    expect(new Set([runId, ...server.modelRunIds()]).size).toBe(3);
    expect(nested.map(({ body }) => body)).toMatchObject([
      { type: 'reasoning', name: 'verdict', status: 'succeeded', output: { approve: true }, ...startedLocally },
      { type: 'reasoning', name: 'summary', status: 'succeeded', output: 'Within policy.', ...startedLocally },
    ]);
  });

  it('takes the other branch on the other answer, without executing the second definition', async () => {
    await serving(answers(jsonResult({ approve: false })));

    const runId = await ran('expense-review', { expense: 'a yacht' });

    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'succeeded', output: { approved: false } },
    });
    expect(server.modelCalls()).toBe(1);
  });
});

describe('a nested definition that rejects its input, over HTTP', () => {
  it('is an error the workflow catches with try, and recovers from', async () => {
    await serving();

    const runId = await ran('recovering', {});

    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'succeeded', output: { recovered: true } },
    });
    expect(server.modelCalls()).toBe(0);
  });

  it('settles the workflow rejected when nothing catches it', async () => {
    await serving();

    const runId = await ran('careless', {});

    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'invalid_input' } },
    });
  });
});

describe('the history of a workflow run, over HTTP', () => {
  it('shows each input the run took, with the steps that moved and how they ended', async () => {
    await serving(answers(jsonResult({ approve: false })));

    const runId = await ran('expense-review', { expense: 'a yacht' });
    await settledRun(server, `${alpha}/runs/${runId}`);
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    const { events } = historyOf(history.body);
    const callKey = JSON.stringify([`acme/alpha/${runId}`, '/do/0/judge', 1]);

    expect(events.map(({ type }) => type).toSorted()).toEqual(typesOfTheDeclinedReview);
    expect(events.filter(({ type }) => type === 'workflow_input_applied')).toEqual([
      {
        type: 'workflow_input_applied',
        summary: 'The workflow started, and 1 step moved.',
        data: {
          input: { kind: 'started', key: runId },
          step_count: 1,
          steps: [{ task: '/do/0/judge', run: 1, outcome: 'waiting' }],
          output_kinds: ['arm_timer', 'start_call'],
        },
      },
      {
        type: 'workflow_input_applied',
        summary: 'A function the workflow called answered, and 3 steps moved; the workflow ended.',
        data: {
          input: { kind: 'call_answered', key: callKey, status: 'succeeded' },
          step_count: 3,
          steps: [
            { task: '/do/0/judge', run: 1, outcome: 'completed' },
            { task: '/do/1/route', run: 1, outcome: 'completed' },
            { task: '/do/3/decline', run: 1, outcome: 'completed' },
          ],
          output_kinds: ['cancel_timer', 'settle'],
        },
      },
    ]);
  });
});
