import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';

const [pace = '', paceInput = ''] = blocksInOrderOf('reference/computation-format.md').map(({ body }) => body);

const [, history = '', historyInput = '', historyAnswer = ''] = blocksInOrderOf('reference/lookup-format.md').map(
  ({ body }) => body,
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const RowSchema = Schema.Struct({ campaign: Schema.String, cost_cents: Schema.Int, budget_cents: Schema.Int });

const decodePaceInput = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ rows: Schema.Array(RowSchema), period: Schema.Json })),
);

const decodeAnswer = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ runs: Schema.Tuple([Schema.Struct({ run_id: Schema.String, output: Schema.Json })]) }),
  ),
);

const aMoment: unknown = expect.any(String);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function saved(type: string, name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source, diagram: 'none' } });
}

function paced(input: Schema.Json, runId: string) {
  return server.call('POST', `${alpha}/definitions/computation/campaign-pace/run`, {
    body: { input, run_id: runId },
  });
}

describe('the example of a lookup function that reads runs, through the server', () => {
  it('answers the runs of the computation function the page names, which then names the lookup among its users', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const {
      runs: [shown],
    } = decodeAnswer(historyAnswer);
    const { rows, period } = decodePaceInput(paceInput);
    const springSaleAlone = { rows: rows.filter(({ campaign }) => campaign === 'spring-sale'), period };

    const created = [await saved('computation', 'campaign-pace', pace), await saved('lookup', 'pace-history', history)];
    await paced(decodeJson(paceInput), shown.run_id);
    await paced(springSaleAlone, '019a2a1e-ae00-7c1a-9b3f-2f1e0d9c8b7a');
    const ran = await server.call('POST', `${alpha}/definitions/lookup/pace-history/run`, {
      body: { input: decodeJson(historyInput), run_id: '019a2f44-0a00-7c1a-9b3f-2f1e0d9c8b7a' },
    });
    const read = await server.call('GET', `${alpha}/runs/019a2f44-0a00-7c1a-9b3f-2f1e0d9c8b7a`);
    const used = await server.call('GET', `${alpha}/definitions/computation/campaign-pace`);

    expect(created.map(({ status }) => status)).toEqual([201, 201]);
    expect(ran.body).toMatchObject({
      status: 'succeeded',
      output: { runs: [{ run_id: shown.run_id, definition_version: 1, output: shown.output }], more: false },
    });
    expect(read.body).toMatchObject({ record: { examined: 2, through: aMoment } });
    expect(used.body).toMatchObject({ used_by: [{ type: 'lookup', name: 'pace-history', relation: 'reads' }] });
  });
});
