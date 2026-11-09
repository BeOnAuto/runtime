import { nestedRunId } from '@on.auto/definitions';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const verdict = ['---', 'model: openai/gpt-5', '---', 'Should we approve {{ input.expense }}?'].join('\n');

const judging = workflowSource(
  'judging',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: lunch } }
`,
);

const reviewing = workflowSource(
  'reviewing',
  `do:
  - review:
      call: run_definition
      with: { type: workflow, name: judging }
`,
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingAPausedVerdict(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'verdict', source: verdict, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'judging', source: judging } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'reviewing', source: reviewing } });
  expect((await server.call('POST', `${alpha}/definitions/reasoning/verdict/pause`, { body: {} })).status).toBe(200);
}

describe('a workflow that called a workflow whose step calls a paused function, over HTTP', () => {
  it('names its own step and the run it started as the cause, with the codes of the paused function inside', async () => {
    await servingAPausedVerdict();
    const started = await server.call('POST', `${alpha}/definitions/workflow/reviewing/run`, { body: { input: {} } });
    const reviewRun = runIdIn(started.body);
    const judgeRun = nestedRunId(reviewRun, '/do/0/review', 1);
    const paused = { status: 'rejected', reason: 'conflict', kind: 'paused' };

    expect(await settledRun(server, `${alpha}/runs/${reviewRun}`)).toMatchObject({
      body: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', cause: { step: 'do/0/review', run_id: judgeRun, ...paused } },
      },
    });
    expect(await settledRun(server, `${alpha}/runs/${judgeRun}`)).toMatchObject({
      body: {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          cause: { step: 'do/0/judge', run_id: nestedRunId(judgeRun, '/do/0/judge', 1), ...paused },
        },
      },
    });
  });
});
