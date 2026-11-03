import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const day = 86_400_000;

const week = 7 * day;

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

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function mondayWeeksAgo(ago: number): string {
  const now = Date.now();
  const daysSinceMonday = (new Date(now).getUTCDay() + 6) % 7;
  const monday = Math.floor(now / day) * day - daysSinceMonday * day;
  return new Date(monday - ago * week).toISOString().slice(0, 10);
}

function revenueOf(ago: number): number {
  return 48_000 + (ago % 4) * 150;
}

async function created(server: ReasoningServer, type: string, name: string, source: string): Promise<void> {
  const answer = await server.call('POST', `${alpha}/definitions/${type}`, {
    body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
  });
  expect(answer.status).toBe(201);
}

async function recorded(server: ReasoningServer, ago: number): Promise<void> {
  const ran = await server.call('POST', `${alpha}/definitions/computation/record-week/run`, {
    body: { input: { store: 'north', week_start: mondayWeeksAgo(ago), revenue: revenueOf(ago) } },
  });
  expect(ran.body).toMatchObject({ status: 'succeeded' });
}

async function servingWeeks(): Promise<ReasoningServer> {
  const server = await servingWorkflows([]);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await created(server, 'computation', 'record-week', recordWeek);
  await created(server, 'prediction', 'weekly-revenue', weeklyRevenue);
  await created(server, 'workflow', 'close-and-forecast', closeAndForecast);
  await Array.from({ length: weeksBefore }, (_, at) => weeksBefore + 1 - at).reduce(
    (before: Promise<void>, ago) => before.then(() => recorded(server, ago)),
    Promise.resolve(),
  );
  await until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/prediction/weekly-revenue`);
    expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: weeksBefore } } });
  });
  return server;
}

async function lastObserved(server: ReasoningServer, revenue: number): Promise<unknown> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/close-and-forecast/run`, {
    body: { input: { store: 'north', week_start: mondayWeeksAgo(1), revenue } },
  });
  const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return settled.body;
}

describe('a workflow that records a week and forecasts from it in the next step, in a playbook that keeps a page', () => {
  it('forecasts from the week it just recorded every time, without asking again', { timeout: 120_000 }, async () => {
    const server = await servingWeeks();
    const revenues = Array.from({ length: forecasts }, (_, at) => 50_000 + at);

    const answers = await revenues.reduce(
      async (before: Promise<readonly unknown[]>, revenue) => [...(await before), await lastObserved(server, revenue)],
      Promise.resolve([]),
    );

    expect(answers).toMatchObject(revenues.map((revenue) => ({ status: 'succeeded', output: { value: revenue } })));
  });
});
