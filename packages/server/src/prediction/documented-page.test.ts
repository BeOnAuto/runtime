import { randomUUID } from 'node:crypto';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { until } from '../testing/waiting/until.ts';

const blocks = blocksInOrderOf('reference/prediction-format.md');

const weeklyOrders = String(blocks.find(({ language }) => language === 'markdown')?.body);

const keptForecasts = String(
  blocks.find(({ language, body }) => language === 'yaml' && body.includes('subject: prediction/weekly-orders'))?.body,
);

const withKeptForecasts = weeklyOrders.replace('page:\n', keptForecasts);

const week = 7 * 86_400_000;

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Struct({ runs: Schema.String }) }));

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

interface OrderPlaced {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly data: { readonly region: string; readonly placed_at: string };
}

function orderPlaced(weeksAgo: number): OrderPlaced {
  const placedAt = new Date(Date.now() - weeksAgo * week).toISOString();
  return {
    id: randomUUID(),
    source: '/shop',
    type: 'order.placed',
    time: placedAt,
    data: { region: 'north', placed_at: placedAt },
  };
}

describe('the page of the prediction format that keeps the forecasts, through the server', () => {
  it('saves beside the result of the example, and draws the forecast of the next week beside the orders observed', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const saved = await server.call('POST', `${alpha}/definitions/prediction`, {
      body: { name: 'weekly-orders', source: withKeptForecasts, diagram: 'none' },
    });
    const events = Array.from({ length: 12 }, (_, at) => orderPlaced(12 - at));
    await Promise.all(events.map((event) => server.call('POST', `${alpha}/events`, { body: { event } })));
    await until(async () => {
      const { body } = await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`);
      expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: events.length } } });
    });

    const asked = await server.call('POST', `${alpha}/definitions/prediction/weekly-orders/run`, {
      body: { input: { series: 'north' } },
    });
    const definition = await until(
      async () => (await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`)).body,
      (body) => JSON.stringify(body).includes('"folded":1'),
    );

    expect(saved.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'succeeded' });
    expect(decodeRuns(definition).page.runs).toMatch(
      /^```chart line\n\{"unit":"orders","period":"week","lines":\[\{"name":"Forecast","points":\[\{"at":"\d{4}-W\d{2}","value":[\d.]+\}\]\},\{"name":"Orders","points":\[\{"at":"\d{4}-W\d{2}","value":1\}\]\}\]\}\n```$/u,
    );
  });
});
