import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const ListedRuns = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      started_by: Schema.Struct({ id: Schema.String, name: Schema.String }),
    }),
  ),
});

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const historyIn = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

type ListedRun = (typeof ListedRuns.Type)['runs'][number];

const closing = workflowSource(
  'close-the-month',
  "schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { month: '${ $data[0].data.month }' } }\n",
);

const announcing = workflowSource(
  'announce',
  'do:\n  - announce: { emit: { event: { with: { type: com.acme.ledger.closed, source: https://acme.example/ledger, data: { month: october } } } } }\n',
);

const approving = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function created([name, source]: readonly [string, string]): Promise<void> {
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source } });
}

async function servingWith(...definitions: readonly (readonly [string, string])[]): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await definitions.reduce<Promise<void>>(
    (before, definition) => before.then(() => created(definition)),
    Promise.resolve(),
  );
}

function runsOf(name: string): Promise<readonly ListedRun[]> {
  return until(
    async () => runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body).runs,
    (runs) => runs.some(({ status }) => status !== 'started'),
  );
}

async function historyOf(path: string): Promise<readonly string[]> {
  const history = await server.call('GET', `${path}/history`);
  return historyIn(history.body).events.map(({ type }) => type);
}

async function triggeredRunOf(name: string) {
  const [run] = await runsOf(name);
  const settled = await settledRun(server, `${alpha}/runs/${run?.run_id ?? ''}`);
  return { run, settled };
}

describe('a workflow whose trigger is an event', () => {
  it('is run by the playbook itself for an event published to the playbook, with the event as its input', async () => {
    await servingWith(['close-the-month', closing]);

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } } },
    });
    const { run, settled } = await triggeredRunOf('close-the-month');

    expect(run).toMatchObject({ status: 'succeeded', started_by: { id: 'playbook:alpha', name: 'alpha' } });
    expect(settled.body).toMatchObject({ status: 'succeeded', output: { month: 'september' } });
  });

  it('is run for an event another workflow emits', async () => {
    await servingWith(['close-the-month', closing], ['announce', announcing]);

    const announced = await server.call('POST', `${alpha}/definitions/workflow/announce/run`, {
      body: { input: {} },
    });
    await settledRun(server, `${alpha}/runs/${runIdIn(announced.body)}`);
    const { settled } = await triggeredRunOf('close-the-month');

    expect(settled.body).toMatchObject({ status: 'succeeded', output: { month: 'october' } });
  });
});

describe('a run waiting for an event whose type its filter names', () => {
  it('takes one published to its playbook', async () => {
    await servingWith(['approval', approving]);
    const started = await server.call('POST', `${alpha}/definitions/workflow/approval/run`, { body: { input: {} } });
    const path = `${alpha}/runs/${runIdIn(started.body)}`;
    await until(
      () => historyOf(path),
      (history) => history.includes('step_waiting'),
    );

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/desk', type: 'com.acme.approved', data: { by: 'Ada' } } },
    });
    const settled = await settledRun(server, path);

    expect(settled.body).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
  });
});
