import { nestedRunId } from '@on.auto/definitions';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { describe, expect, it } from 'vitest';

import { accountsServed, installation, servedBy } from '../testing/accounts/licensed-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize acme.'].join('\n');

const asking = workflowSource(
  'asking',
  'do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }\n',
);

const nesting = workflowSource(
  'nesting',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking } }\n',
);

function actionOf(runId: string): string {
  return `installation:${installation}/acme/alpha/${runId.toLowerCase()}`;
}

describe('a workflow of a licensed runtime that calls a workflow that calls a function', () => {
  it('counts one action for each of the three runs, asking the account once for each run id', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, {}, [
      answers(textResult('Short.')),
    ]);
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting', source: nesting } });
    const started = await server.call('POST', `${alpha}/definitions/workflow/nesting/run`, { body: { input: {} } });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
    const nested = nestedRunId(runIdIn(started.body), '/do/0/nest', 1);
    const runs = [runIdIn(started.body), nested, nestedRunId(nested, '/do/0/ask', 1)];
    await server.stop();

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(accounts.account.charged()).toEqual(runs.map((run) => actionOf(run)));
    expect(accounts.account.askedToAdmit()).toBe(3);
    expect(accounts.account.reports().at(-1)?.actions).toBe(3);
  });
});
