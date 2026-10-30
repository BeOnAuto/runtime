import { weeklyOrders } from '@on.auto/prediction/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const question = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const byTheDefaultForecast: unknown = expect.objectContaining({
  version: null,
  default_forecast: true,
  runtime: { name: 'series', version: release.version },
});

const build = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

function saved(server: ReasoningServer, name: string, source = weeklyOrders) {
  return server.call('POST', `${alpha}/definitions/prediction`, { body: { name, source } });
}

function published(server: ReasoningServer, id: string, data: object) {
  return server.call('POST', `${alpha}/events`, {
    body: { event: { id, source: '/shop', type: 'order.placed', data } },
  });
}

function standingUntil(server: ReasoningServer, folded: number, passedOver: number): Promise<unknown> {
  return until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`);
    expect(body).toMatchObject({
      standing: { dataset: { phase: 'live', events_folded: folded, passed_over: passedOver } },
    });
    return body;
  });
}

function historyOf(server: ReasoningServer, runId: string) {
  return server.call('GET', `${alpha}/runs/${runId}/history`);
}

describe('a prediction function saved over HTTP', () => {
  it('is saved from its document with its input and output derived from it, and stands on the dataset it folds from the events the playbook records', async () => {
    const server = await serving();

    const created = await saved(server, 'weekly-orders');
    await published(server, 'o-1', { placed_at: '2026-10-06T10:00:00Z', region: 'north', total: 30, promotion: 1 });
    await published(server, 'o-2', { placed_at: '2026-10-07T10:00:00Z', region: 'north', total: 10 });
    await published(server, 'o-3', { placed_at: '2026-10-07T11:00:00Z', region: 7, total: 10 });
    const standing = await standingUntil(server, 2, 1);

    expect(created).toMatchObject({
      status: 201,
      body: {
        type: 'prediction',
        media_type: 'text/markdown',
        input_schema: { oneOf: [{ title: 'question' }, { title: 'build' }] },
        output_schema: { $id: 'https://on.auto/shapes/series', title: 'series' },
        details: { shape: 'series' },
      },
    });
    expect(standing).toMatchObject({
      standing: {
        dataset: {
          kind: 'projection',
          rows: 1,
          series: 1,
          first_period: '2026-W41',
          last_period: '2026-W41',
          passed_over: 1,
        },
      },
    });
  });
});

describe('a run of a prediction function over HTTP before a version is built', () => {
  it('answers a question from the default forecast of the runtime’s own models, since no version is active, and takes a build, which finishes later as it waits for its trainer', async () => {
    const server = await serving();
    await saved(server, 'weekly-orders');
    await published(server, 'o-1', { placed_at: '2026-10-06T10:00:00Z', region: 'north', total: 30, promotion: 1 });
    await standingUntil(server, 1, 0);
    const run = `${alpha}/definitions/prediction/weekly-orders/run`;

    const asked = await server.call('POST', run, {
      body: { input: { series: 'north', horizon: 1, given: { promotion: 1 } }, run_id: question },
    });
    const built = await server.call('POST', run, { body: { input: { build: {} }, run_id: build } });
    const histories = await Promise.all([historyOf(server, question), historyOf(server, build)]);

    expect([asked.status, asked.body]).toEqual([
      200,
      expect.objectContaining({ status: 'succeeded', record: byTheDefaultForecast }),
    ]);
    expect([built.status, built.body]).toEqual([200, expect.objectContaining({ status: 'started', run_id: build })]);
    expect(histories.map(({ body }) => body)).toMatchObject([
      { events: [{ type: 'run_started', data: { input: { series: 'north' } } }, { type: 'run_succeeded' }] },
      {
        events: [{ type: 'run_started', data: { finishes_later: true } }, { type: 'dataset_assembled' }],
      },
    ]);
    expect(histories[0]?.body).not.toHaveProperty('events.0.data.finishes_later');
  });
});

describe('the prediction functions a playbook keeps', () => {
  it('are refused at save past PREDICTION_MAX_FUNCTIONS active functions of a playbook', async () => {
    const server = await serving({ PREDICTION_MAX_FUNCTIONS: '1' });

    const first = await saved(server, 'weekly-orders');
    const second = await saved(server, 'more-orders');

    expect([first.status, second.status]).toEqual([201, 409]);
    expect(second.body).toMatchObject({
      detail:
        'The playbook keeps 1 active prediction functions, and a playbook may keep at most 1; retire one before creating another',
    });
  });
});
