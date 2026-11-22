import { randomUUID } from 'node:crypto';

import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import {
  runIdIn,
  servingWorkflows,
  settledRun,
  steppedServerClock,
  testServersStartAt,
  workflowSource,
} from '../testing/servers/workflow-server.ts';
import { whenHeld } from '../testing/waiting/until.ts';
import { dailyVisits, publishedVisits, savedVisits, visitsOf, visitsToday } from './published-visits.ts';

const closing: (() => Promise<void>)[] = [];

const question = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const aCheckpoint: unknown = expect.any(String);

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const serverPrediction = await servingReasoning([], environment, undefined, {
    clock: steppedServerClock(),
  });
  closing.push(serverPrediction.stop);
  await serverPrediction.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return serverPrediction;
}

function asked(serverPrediction: ReasoningServer, input: object, runId?: string) {
  return serverPrediction.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
    body: { input, ...(runId === undefined ? {} : { run_id: runId }) },
  });
}

const blocks = blocksInOrderOf('reference/prediction-format.md');

const weeklyOrders = String(blocks.find(({ language }) => language === 'markdown')?.body);

const keptForecasts = String(
  blocks.find(({ language, body }) => language === 'yaml' && body.includes('subject: prediction/weekly-orders'))?.body,
);

const withKeptForecasts = weeklyOrders.replace('page:\n', keptForecasts);

const week = 7 * 86_400_000;

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Struct({ runs: Schema.String }) }));

let server: ReasoningServer;

interface OrderPlaced {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly data: { readonly region: string; readonly placed_at: string };
}

function orderPlaced(weeksAgo: number): OrderPlaced {
  const placedAt = new Date(testServersStartAt - weeksAgo * week).toISOString();
  return {
    id: randomUUID(),
    source: '/shop',
    type: 'order.placed',
    time: placedAt,
    data: { region: 'north', placed_at: placedAt },
  };
}

const day = 86_400_000;

const weekForecastAfterRecord = 7 * day;

const weeksBefore = 10;

const forecasts = 20;

const recordWeek = [
  '---',
  'language: typescript',
  'input:',
  '  schema: {type: object, properties: {store: {type: string}, week_start: {type: string}, revenue: {type: number}}, required: [store, week_start, revenue]}',
  'page:',
  '  data:',
  '    language: typescript',
  '    source:',
  '      events:',
  '        - type: run_succeeded',
  '          subject: computation/record-week',
  '    views:',
  '      by_store: categories',
  '    module: |',
  '      export function fold(view: View, event: Event): View {',
  '        return { by_store: { values: [...(view.by_store?.values ?? []), { name: event.type, value: 1 }] } };',
  '      }',
  '  result: Recorded.',
  "  runs: '{% for value in views.by_store.values %}{{ value.name }}{% endfor %}'",
  '---',
  'export default function (input: Input): Output {',
  '  return input;',
  '}',
].join('\n');

const weeklyRevenue = [
  '---',
  'description: Predicts the revenue of each store next week, from the weeks record-week recorded',
  'predicts:',
  '  target: revenue',
  '  period: week',
  '  horizons: [1]',
  '  unit: USD',
  'data:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: computation/record-week',
  '  time: /output/week_start',
  '  series: /output/store',
  '  target: { of: /output/revenue, as: last }',
  '  window: 104',
  '---',
].join('\n');

const closeAndForecast = workflowSource(
  'close-and-forecast',
  `do:
  - record:
      call: run_definition
      with: { type: computation, name: record-week, input: '\${ $data }' }
  - forecast:
      call: run_definition
      with: { type: prediction, name: weekly-revenue, input: { series: '\${ $data.store }', horizon: 1 } }
      output:
        as: '\${ $data.lines[0].points.at(-1) }'
`,
);

function mondayWeeksAgo(ago: number): string {
  const now = testServersStartAt;
  const daysSinceMonday = (new Date(now).getUTCDay() + 6) % 7;
  const monday = Math.floor(now / day) * day - daysSinceMonday * day;
  return new Date(monday - ago * weekForecastAfterRecord).toISOString().slice(0, 10);
}

function revenueOf(ago: number): number {
  return 48_000 + (ago % 4) * 150;
}

async function created(
  serverForecastAfterRecord: ReasoningServer,
  type: string,
  name: string,
  source: string,
): Promise<void> {
  const answer = await serverForecastAfterRecord.call('POST', `${alpha}/definitions/${type}`, {
    body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
  });
  expect(answer.status).toBe(201);
}

async function recorded(serverForecastAfterRecord: ReasoningServer, ago: number): Promise<void> {
  const ran = await serverForecastAfterRecord.call('POST', `${alpha}/definitions/computation/record-week/run`, {
    body: { input: { store: 'north', week_start: mondayWeeksAgo(ago), revenue: revenueOf(ago) } },
  });
  expect(ran.body).toMatchObject({ status: 'succeeded' });
}

async function servingWeeks(): Promise<ReasoningServer> {
  const serverForecastAfterRecord = await servingWorkflows([], {}, undefined, steppedServerClock());
  closing.push(serverForecastAfterRecord.stop);
  await serverForecastAfterRecord.call('POST', '/v1/orgs/acme/playbooks', {
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  await created(serverForecastAfterRecord, 'computation', 'record-week', recordWeek);
  await created(serverForecastAfterRecord, 'prediction', 'weekly-revenue', weeklyRevenue);
  await created(serverForecastAfterRecord, 'workflow', 'close-and-forecast', closeAndForecast);
  await Array.from({ length: weeksBefore }, (_, at) => weeksBefore + 1 - at).reduce(
    (before: Promise<void>, ago) => before.then(() => recorded(serverForecastAfterRecord, ago)),
    Promise.resolve(),
  );
  await whenHeld(async () => {
    const { body } = await serverForecastAfterRecord.call('GET', `${alpha}/definitions/prediction/weekly-revenue`);
    expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: weeksBefore } } });
  });
  return serverForecastAfterRecord;
}

async function lastObserved(serverForecastAfterRecord: ReasoningServer, revenue: number): Promise<unknown> {
  const started = await serverForecastAfterRecord.call('POST', `${alpha}/definitions/workflow/close-and-forecast/run`, {
    body: { input: { store: 'north', week_start: mondayWeeksAgo(1), revenue } },
  });
  const settled = await settledRun(serverForecastAfterRecord, `${alpha}/runs/${runIdIn(started.body)}`);
  return settled.body;
}

describe('prediction over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a prediction function saved over HTTP', () => {
    it('is saved from its document with the question as its input and the series as its output, and stands on the dataset it folds from the events the playbook records', async () => {
      const serverPrediction = await serving();
      const visits = visitsToday();

      await savedVisits(serverPrediction);
      await publishedVisits(serverPrediction, visits, { north: 2, south: 1 });
      const { body } = await serverPrediction.call('GET', `${alpha}/definitions/prediction/daily-visits`);

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
      const serverPrediction = await serving();
      const visits = visitsToday();
      await savedVisits(serverPrediction);
      await publishedVisits(serverPrediction, visits, { north: 8 });

      const answer = await asked(serverPrediction, { series: 'north' }, question);
      const history = await serverPrediction.call('GET', `${alpha}/runs/${question}/history`);

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
      const serverPrediction = await serving();
      const visits = visitsToday();
      await savedVisits(serverPrediction);
      await publishedVisits(serverPrediction, visits, { north: 3 });

      const refused = await asked(serverPrediction, { series: 'north', horizon: 1 });

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
      const serverPrediction = await serving({ PREDICTION_MAX_FUNCTIONS: '1' });

      await savedVisits(serverPrediction);
      const second = await serverPrediction.call('POST', `${alpha}/definitions/prediction`, {
        body: { name: 'more-visits', source: dailyVisits, diagram: 'none' },
      });

      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({
        detail:
          'The playbook keeps 1 prediction functions, and a playbook may keep at most 1; retire one before creating another',
      });
    });
  });
});

describe('documented page', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the page of the prediction format that keeps the forecasts, through the server', () => {
    it('saves beside the result of the example, and draws the forecast of the next week beside the orders observed', async () => {
      server = await servingReasoning([], {}, undefined, { clock: steppedServerClock() });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const saved = await server.call('POST', `${alpha}/definitions/prediction`, {
        body: { name: 'weekly-orders', source: withKeptForecasts, diagram: 'none' },
      });
      const events = Array.from({ length: 12 }, (_, at) => orderPlaced(12 - at));
      await Promise.all(events.map((event) => server.call('POST', `${alpha}/events`, { body: { event } })));
      await whenHeld(async () => {
        const { body } = await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`);
        expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: events.length } } });
      });

      const askedDocumentedPage = await server.call('POST', `${alpha}/definitions/prediction/weekly-orders/run`, {
        body: { input: { series: 'north' } },
      });
      const definition = await whenHeld(
        async () => (await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`)).body,
        (body) => JSON.stringify(body).includes('"folded":1'),
      );

      expect(saved.status).toBe(201);
      expect(askedDocumentedPage.body).toMatchObject({ status: 'succeeded' });
      expect(decodeRuns(definition).page.runs).toMatch(
        /^```chart line\n\{"unit":"orders","period":"week","lines":\[\{"name":"Forecast","points":\[\{"at":"\d{4}-W\d{2}","value":[\d.]+\}\]\},\{"name":"Orders","points":\[\{"at":"\d{4}-W\d{2}","value":1\}\]\}\]\}\n```$/u,
      );
    });
  });
});

describe('forecast after a record', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a workflow that records a week and forecasts from it in the next step, in a playbook that keeps a page', () => {
    it('forecasts from the week it just recorded every time, without asking again', async () => {
      const serverForecastAfterRecord = await servingWeeks();
      const revenues = Array.from({ length: forecasts }, (_, at) => 50_000 + at);

      const answers = await revenues.reduce(
        async (before: Promise<readonly unknown[]>, revenue) => [
          ...(await before),
          await lastObserved(serverForecastAfterRecord, revenue),
        ],
        Promise.resolve([]),
      );

      expect(answers).toMatchObject(revenues.map((revenue) => ({ status: 'succeeded', output: { value: revenue } })));
    });
  });

  describe('a workflow that records a week and forecasts from it, once the function that records it is renamed', () => {
    it('forecasts from the week the renamed function recorded, its prediction function saved again with the new name', async () => {
      const serverRenamed = await servingWeeks();

      const renamed = await serverRenamed.call('PUT', `${alpha}/definitions/computation/record-week`, {
        body: { new_name: 'record-a-week' },
      });
      const savedAgain = await whenHeld(async () => {
        const { body } = await serverRenamed.call('GET', `${alpha}/definitions/prediction/weekly-revenue`);
        expect(body).toMatchObject({
          version: 2,
          standing: { dataset: { phase: 'live', events_folded: weeksBefore } },
        });
        return body;
      });
      const answer = await lastObserved(serverRenamed, 50_000);

      expect(renamed).toMatchObject({
        status: 200,
        body: { name: 'record-a-week', used_by: [{ type: 'workflow', name: 'close-and-forecast' }] },
      });
      expect(savedAgain).toMatchObject({
        source: weeklyRevenue.replace('computation/record-week', 'computation/record-a-week'),
      });
      expect(answer).toMatchObject({ status: 'succeeded', output: { value: 50_000 } });
    });
  });
});

describe('prediction over mcp', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the plain words for a question to a prediction function over MCP', () => {
    it('say each predicted number in digits with its unit after it, the coverage of its ranges and the method, and name no internal term', async () => {
      server = await servingReasoning([], {}, undefined, { clock: steppedServerClock() });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const visits = visitsToday();
      await savedVisits(server);
      await publishedVisits(server, visits, { north: 8 });

      const askedPrediction = await withMcpSession(
        'current revision',
        { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
        (session) =>
          session.callTool('run_definition', { type: 'prediction', name: 'daily-visits', input: { series: 'north' } }),
      );

      expect(plainTextIn(askedPrediction)).toContain(
        `From ${visits.dayOf(1)}, it predicts 11 visits in ${visits.dayOf(0)} (10 to 13 visits) and 11 visits in ${visits.dayOf(-1)} (9 to 12 visits), each range meant to hold the truth 8 times in 10, by carrying the last observed value forward.`,
      );
      expect(internalTermsIn(plainTextIn(askedPrediction), ['visits'])).toEqual([]);
    });
  });
});
