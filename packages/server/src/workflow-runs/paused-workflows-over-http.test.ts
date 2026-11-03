import { localDeveloper } from '@on.auto/identity/testing';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const aMinuteAndASecond = 61_000;

function triggered(name: string): string {
  return workflowSource(
    name,
    [
      'schedule:',
      '  on: { one: { with: { type: com.acme.ledger.closed } } }',
      '  every: PT1M',
      'do:',
      "  - keep: { set: { input: '${ $data }' } }",
      '',
    ].join('\n'),
  );
}

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const reviewing = workflowSource(
  'review',
  `do:
  - wait: { listen: { to: { one: { with: { type: com.acme.review.ready } } } } }
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: lunch } }
`,
);

const ListedRuns = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const KeptInput = Schema.Struct({ output: Schema.Struct({ input: Schema.Unknown }) });

const keptInputOf = Schema.decodeUnknownSync(KeptInput);

const isPausedSince = Schema.is(Schema.Struct({ status: Schema.Literal('paused'), paused_at: Schema.String }));

const isScheduled = Schema.is(Schema.Struct({ schedule: Schema.Struct({ due: Schema.String }) }));

const isActive = Schema.is(Schema.Struct({ status: Schema.Literal('active') }));

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingAPlaybook(clock?: MovedClock): Promise<void> {
  server = await servingWorkflows([], {}, undefined, clock);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
}

async function created(type: string, body: object): Promise<void> {
  expect((await server.call('POST', `${alpha}/definitions/${type}`, { body })).status).toBe(201);
}

function standingChanged(name: string, change: 'pause' | 'resume', body: object = {}) {
  return server.call('POST', `${alpha}/definitions/workflow/${name}/${change}`, { body });
}

function published(month: string) {
  return server.call('POST', `${alpha}/events`, {
    body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month } } },
  });
}

async function runIdsOf(name: string): Promise<readonly string[]> {
  return runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body).runs.map(
    ({ run_id: runId }) => runId,
  );
}

function runsReaching(name: string, count: number): Promise<readonly string[]> {
  return until(
    () => runIdsOf(name),
    (runs) => runs.length >= count,
  );
}

async function inputsOf(name: string): Promise<readonly unknown[]> {
  const runs = await runIdsOf(name);
  const settled = await Promise.all(runs.map((runId) => settledRun(server, `${alpha}/runs/${runId}`)));
  return settled.map(({ body }) => keptInputOf(body).output.input).toReversed();
}

describe('a workflow paused and resumed over HTTP', () => {
  it('stands paused with who paused it, when and why, refuses a run by hand in the runtime’s words, and runs again once resumed', async () => {
    await servingAPlaybook();
    await created('workflow', { name: 'close-the-month', source: triggered('close-the-month') });

    const paused = await standingChanged('close-the-month', 'pause', { reason: 'The books are closed by hand' });
    const refused = await server.call('POST', `${alpha}/definitions/workflow/close-the-month/run`, { body: {} });
    const read = await server.call('GET', `${alpha}/definitions/workflow/close-the-month`);
    const resumed = await standingChanged('close-the-month', 'resume');
    const ran = await server.call('POST', `${alpha}/definitions/workflow/close-the-month/run`, { body: {} });

    expect(paused).toMatchObject({
      status: 200,
      body: {
        status: 'paused',
        version: 1,
        paused_by: { id: 'local', name: localDeveloper.name },
        reason: 'The books are closed by hand',
      },
    });
    expect(refused).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        kind: 'paused',
        detail: 'The workflow close-the-month is paused and starts no runs until it is resumed',
      },
    });
    expect(isPausedSince(read.body)).toBe(true);
    expect(resumed).toMatchObject({ status: 200, body: { status: 'active', version: 1 } });
    expect(resumed.body).not.toHaveProperty('paused_at');
    expect((await settledRun(server, `${alpha}/runs/${runIdIn(ran.body)}`)).body).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('the triggers of a workflow paused and resumed', () => {
  it('start nothing for an event or a due time while it is paused, the due time swept after the pause, and replay none once it is resumed', async () => {
    const clock = movedClock(Date.now());
    await servingAPlaybook(clock);
    await created('workflow', { name: 'close-the-month', source: triggered('close-the-month') });
    await created('workflow', { name: 'witness', source: triggered('witness') });
    const savedBy = Date.now();

    await standingChanged('close-the-month', 'pause');
    clock.moveTo(savedBy + aMinuteAndASecond);
    await published('while paused');
    await runsReaching('witness', 2);
    const whilePaused = await runIdsOf('close-the-month');

    const resumedAfter = Date.now();
    const resumed = await standingChanged('close-the-month', 'resume');
    await published('once resumed');
    await runsReaching('close-the-month', 2);
    const inputs = await inputsOf('close-the-month');
    const dues = inputs.filter((input) => isScheduled(input)).map(({ schedule }) => schedule.due);

    expect([whilePaused, isActive(resumed.body)]).toEqual([[], true]);
    expect(inputs).toHaveLength(2);
    expect(inputs).toContainEqual([expect.objectContaining({ data: { month: 'once resumed' } })]);
    expect(dues.map((due) => Date.parse(due) > resumedAfter)).toEqual([true]);
  });
});

describe('a workflow whose step calls a function paused while the run waits', () => {
  it('ends that run as a step that calls a retired function ends it, in the runtime’s words of a pause', async () => {
    await servingAPlaybook();
    await created('reasoning', { name: 'verdict', source: verdict, diagram: 'none' });
    await created('workflow', { name: 'review', source: reviewing });
    const ranUntilItWaits = async () => {
      const started = await server.call('POST', `${alpha}/definitions/workflow/review/run`, { body: { input: {} } });
      return `${alpha}/runs/${runIdIn(started.body)}`;
    };
    const ready = () =>
      server.call('POST', `${alpha}/events`, { body: { event: { source: '/desk', type: 'com.acme.review.ready' } } });

    const first = await ranUntilItWaits();
    await server.call('POST', `${alpha}/definitions/reasoning/verdict/pause`, { body: {} });
    await ready();
    const pausedEnding = await settledRun(server, first);
    const second = await ranUntilItWaits();
    await server.call('POST', `${alpha}/definitions/reasoning/verdict/retire`, { body: {} });
    await ready();
    const retiredEnding = await settledRun(server, second);

    expect([pausedEnding.body, retiredEnding.body]).toMatchObject([
      {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail:
            'The reasoning function verdict could not go through, at the step judge: The reasoning function verdict is paused and starts no runs until it is resumed.',
        },
      },
      {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail:
            'The reasoning function verdict could not go through, at the step judge: The reasoning function verdict is retired and can no longer be run.',
        },
      },
    ]);
  });
});
