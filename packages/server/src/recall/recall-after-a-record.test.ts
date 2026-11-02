import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const recalls = 20;

const recordWeek = [
  '---',
  'language: typescript',
  'input:',
  '  schema: {type: object, properties: {store: {type: string}, week_start: {type: string}, revenue: {type: number}}, required: [store, week_start, revenue]}',
  '---',
  'export default function (input: Input): Output {',
  '  return input;',
  '}',
].join('\n');

const lastWeek = recallDocument(
  foldOf(
    'return { ...view, [event.data.output.store]: event.data.output.revenue };',
    'return view[input.store] ?? null;',
  ),
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: computation/record-week',
);

const closeAndRecall = workflowSource(
  'close-and-recall',
  `do:
  - record:
      call: run_definition
      with: { type: computation, name: record-week, input: '\${ $data }' }
  - recall:
      call: run_definition
      with: { type: recall, name: last-week, input: { store: '\${ $data.store }' } }
`,
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function created(server: ReasoningServer, type: string, name: string, source: string): Promise<void> {
  const answer = await server.call('POST', `${alpha}/definitions/${type}`, {
    body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
  });
  expect(answer.status).toBe(201);
}

async function servingWeeks(): Promise<ReasoningServer> {
  const server = await servingWorkflows([]);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await created(server, 'computation', 'record-week', recordWeek);
  await created(server, 'recall', 'last-week', lastWeek);
  await created(server, 'workflow', 'close-and-recall', closeAndRecall);
  await until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/recall/last-week`);
    expect(body).toMatchObject({ standing: { state: 'live' } });
  });
  return server;
}

async function recalled(server: ReasoningServer, revenue: number): Promise<unknown> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/close-and-recall/run`, {
    body: { input: { store: 'north', week_start: '2026-10-26', revenue } },
  });
  const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return settled.body;
}

describe('a workflow that records a week and recalls it in the next step', () => {
  it('recalls the week it just recorded every time, without asking again', { timeout: 120_000 }, async () => {
    const server = await servingWeeks();
    const revenues = Array.from({ length: recalls }, (_, at) => 50_000 + at);

    const answers = await revenues.reduce(
      async (before: Promise<readonly unknown[]>, revenue) => [...(await before), await recalled(server, revenue)],
      Promise.resolve([]),
    );

    expect(answers).toMatchObject(revenues.map((revenue) => ({ status: 'succeeded', output: revenue })));
  });
});
