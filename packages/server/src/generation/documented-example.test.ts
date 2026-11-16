import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { gatewayOnTheLoopback, servingGeneration } from '../testing/servers/generation-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const [productPicture] = blocksInOrderOf('reference/generation-format.md').map(({ body }) => body);

const productPictureAt = `${alpha}/definitions/generation/product-picture`;

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.String, page: Schema.Struct({ result: Schema.String }) }),
);

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Struct({ runs: Schema.String }) }));

describe('the example of the generation function format, through the server', () => {
  it('is saved with its page, links the picture each run made with its size, and draws the pictures of each day', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const server = await servingGeneration(await gatewayOnTheLoopback(), ledger);
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const saved = await server.call('POST', `${alpha}/definitions/generation`, {
      body: { name: 'product-picture', source: productPicture, diagram: 'none' },
    });
    const ran = await server.call('POST', `${productPictureAt}/run`, { body: { input: { product: 'a teapot' } } });
    const run = await server.call('GET', `${alpha}/runs/${runIdIn(ran.body)}`);
    const definition = await until(
      async () => (await server.call('GET', productPictureAt)).body,
      (body) => JSON.stringify(body).includes('"folded":1'),
    );

    expect(saved.status).toBe(201);
    expect(decodeRun(run.body).status).toBe('succeeded');
    expect(decodeRun(run.body).page.result).toMatch(
      /^\[A picture of the product for its listing\]\(http[^)]+\/content\/[^)]+\), 0 MB\.$/u,
    );
    expect(decodeRuns(definition).page.runs).toMatch(
      /^```chart line\n\{"unit":"pictures","period":"day","lines":\[\{"name":"Pictures","points":\[\{"at":"\d{4}-\d{2}-\d{2}","value":1\}\]\}\]\}\n```$/u,
    );
  });
});
