import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';

const [pace, input, output, readCosts, writeSummary, report] = blocksInOrderOf('reference/computation-format.md').map(
  ({ body }) => body,
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function saved(type: string, name: string, source: string | undefined) {
  return server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source } });
}

describe('the example of the computation function format, through the server', () => {
  it('saves the function and answers the output the page shows for its input, after the work it says', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const created = await saved('computation', 'campaign-pace', pace);
    const ran = await server.call('POST', `${alpha}/definitions/computation/campaign-pace/run`, {
      body: { input: decodeJson(input), run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
    });
    const read = await server.call('GET', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a`);

    expect(created.status).toBe(201);
    expect(ran.body).toMatchObject({ status: 'succeeded', output: decodeJson(output) });
    expect(read.body).toMatchObject({ record: { language: 'typescript', work: 0 } });
  });

  it('saves the workflow of the page and the functions it calls, every expression checked', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const created = [
      await saved('computation', 'campaign-pace', pace),
      await saved('interaction', 'read-campaign-costs', readCosts),
      await saved('reasoning', 'write-pace-summary', writeSummary),
      await saved('workflow', 'campaign-pace-report', report),
    ];

    expect(created.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
  });
});
