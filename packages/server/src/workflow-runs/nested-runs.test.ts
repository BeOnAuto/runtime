import { answers, textResult } from '@on.auto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const asking = workflowSource(
  'asking',
  "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
);

const nesting = workflowSource(
  'nesting',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking } }\n',
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingAsking(): Promise<void> {
  server = await servingWorkflows([answers(textResult('Short.')), answers(textResult('Again.'))]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
}

async function settledRunOf(name: string): Promise<TestResponse> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
  return settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
}

describe('a nested run of a workflow', () => {
  it('runs under the id its workflow gives it, so a call again with that id runs the definition once', async () => {
    await servingAsking();

    const settled = await settledRunOf('asking');
    const nested = String(server.modelRunIds()[0]);
    const again = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
      body: { input: { text: 'long' }, run_id: nested },
    });

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(again).toMatchObject({ status: 200, body: { run_id: nested, status: 'succeeded', output: 'Short.' } });
    expect(server.modelCalls()).toBe(1);
  });

  it('may be of another workflow, whose run it waits for under the id it gives that run', async () => {
    await servingAsking();
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting', source: nesting } });

    const settled = await settledRunOf('nesting');
    const nested = String(server.modelRunIds()[0]);
    const askingRuns = await server.call('GET', `${alpha}/runs?name=asking`);

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(askingRuns).toMatchObject({ body: { runs: [{ status: 'succeeded' }] } });
    expect(nested).not.toBe(runIdIn(settled.body));
  });
});
