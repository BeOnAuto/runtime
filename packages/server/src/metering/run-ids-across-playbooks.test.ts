import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, noNetwork, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated } from '../testing/servers/tally-server.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';

const inBeta = { playbook: 'beta', name: 'Beta' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('a run asked for under the id of a run of another playbook of the org', () => {
  it('is refused in the words of a run id held by another before it is admitted, and takes no free run', async () => {
    const server = await servingReasoning([], {}, noNetwork);
    onTestFinished(() => server.stop());
    await tallyCreated(server);
    await tallyCreated(server, inBeta);
    const first = await tallied(server, { run_id: runId });
    await settledRun(server, `${alpha}/runs/${runIdIn(first.body)}`);

    const refused = await tallied(server, { run_id: runId }, inBeta);
    const again = await tallied(server, { run_id: runId });

    expect(refused).toMatchObject({
      status: 409,
      body: { detail: 'The run id belongs to a run of another definition or with another input' },
    });
    expect(again.status).toBe(200);
    expect((await server.call('GET', '/v1/orgs/acme/license')).body).toMatchObject({ free_runs: { used: 1 } });
  }, 60_000);
});
