import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { dailyVisits, publishedVisits, savedVisits, visitsOf, visitsToday } from './published-visits.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const question = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const aCheckpoint: unknown = expect.any(String);

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

function asked(server: ReasoningServer, input: object, runId?: string) {
  return server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
    body: { input, ...(runId === undefined ? {} : { run_id: runId }) },
  });
}

describe('a prediction function saved over HTTP', () => {
  it('is saved from its document with the question as its input and the series as its output, and stands on the dataset it folds from the events the playbook records', async () => {
    const server = await serving();
    const visits = visitsToday();

    await savedVisits(server);
    await publishedVisits(server, visits, { north: 2, south: 1 });
    const { body } = await server.call('GET', `${alpha}/definitions/prediction/daily-visits`);

    expect(body).toMatchObject({
      type: 'prediction',
      media_type: 'text/markdown',
      input_schema: { title: 'question', required: ['series'] },
      output_schema: { $id: 'https://on.auto/shapes/series', title: 'series' },
      details: { shape: 'series' },
      standing: {
        dataset: {
          kind: 'projection',
          phase: 'live',
          rows: 3,
          series: 2,
          first_period: visits.dayOf(2),
          last_period: visits.dayOf(1),
          events_folded: 3,
          passed_over: 0,
        },
      },
    });
  });
});

describe('a question to a prediction function over HTTP', () => {
  it('answers within its call from the dataset as folded now, the forecaster’s record naming the method, the coverage and the history it backtested', async () => {
    const server = await serving();
    const visits = visitsToday();
    await savedVisits(server);
    await publishedVisits(server, visits, { north: 8 });

    const answer = await asked(server, { series: 'north' }, question);
    const history = await server.call('GET', `${alpha}/runs/${question}/history`);

    expect([answer.status, answer.body]).toEqual([
      200,
      expect.objectContaining({
        status: 'succeeded',
        output: {
          unit: 'visits',
          period: 'day',
          origin: visits.dayOf(1),
          lines: [
            {
              name: 'observed',
              points: [4, 3, 2, 1].map((ago) => ({ at: visits.dayOf(ago), value: visitsOf('north', ago) })),
            },
            {
              name: 'predicted',
              points: [
                { at: visits.dayOf(0), value: 11, low: 10, high: 13 },
                { at: visits.dayOf(-1), value: 11, low: 9, high: 12 },
              ],
            },
          ],
        },
        record: {
          method: 'persistence',
          coverage: 0.8,
          season: null,
          history: { periods: 8, first_period: visits.dayOf(8), last_period: visits.dayOf(1), origins: 6 },
          decimals: 0,
          origin: visits.dayOf(1),
          dataset_checkpoint: aCheckpoint,
        },
      }),
    ]);
    expect(history.body).toMatchObject({
      events: [{ type: 'run_started', data: { input: { series: 'north' } } }, { type: 'run_succeeded' }],
    });
    expect(history.body).not.toHaveProperty('events.0.data.finishes_later');
  });
});

describe('a question to a prediction function over HTTP whose series is young', () => {
  it('is refused while the history of its series is too short to backtest, naming the periods it has and the period from which it answers', async () => {
    const server = await serving();
    const visits = visitsToday();
    await savedVisits(server);
    await publishedVisits(server, visits, { north: 3 });

    const refused = await asked(server, { series: 'north', horizon: 1 });

    expect([refused.status, refused.body]).toEqual([
      409,
      expect.objectContaining({
        reason: 'conflict',
        kind: 'history_too_short',
        detail: `The series "north" has 3 periods of history up to ${visits.dayOf(1)}, too few for the forecaster to backtest an answer; ask again from ${visits.dayOf(-2)}`,
      }),
    ]);
  });
});

describe('the prediction functions a playbook keeps', () => {
  it('are refused at save past PREDICTION_MAX_FUNCTIONS active functions of a playbook', async () => {
    const server = await serving({ PREDICTION_MAX_FUNCTIONS: '1' });

    await savedVisits(server);
    const second = await server.call('POST', `${alpha}/definitions/prediction`, {
      body: { name: 'more-visits', source: dailyVisits },
    });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      detail:
        'The playbook keeps 1 active prediction functions, and a playbook may keep at most 1; retire one before creating another',
    });
  });
});
