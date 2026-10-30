import { answers, textResult } from '@on.auto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { ended, runsOf, servingCalls, startedRunOf } from '../testing/servers/workflow-calls.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function settledRunOf(name: string) {
  const started = await startedRunOf(server, name);
  return settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
}

describe('a workflow that calls a workflow, over HTTP', () => {
  it('waits for the run of the workflow it called, which answers the call with its output', async () => {
    server = await servingCalls([answers(textResult('Short.'))]);

    const settled = await settledRunOf('nesting');

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(await runsOf(server, 'asking')).toMatchObject([{ status: 'succeeded' }]);
    expect(server.modelCalls()).toBe(1);
  });

  it('catches the cancellation of the workflow it called, by its kind', async () => {
    server = await servingCalls([]);

    const started = await startedRunOf(server, 'guarded');
    const [pending] = await until(
      () => runsOf(server, 'pending'),
      (runs) => runs.length === 1,
    );
    const cancelled = await server.call('POST', `${alpha}/runs/${String(pending?.run_id)}/cancel`, {
      body: { reason: 'No longer needed' },
    });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

    expect(cancelled).toMatchObject({ status: 200, body: { status: 'started' } });
    expect(settled).toMatchObject({ body: { status: 'succeeded', output: { caught: 'requested' } } });
  });

  it('answers at once when it ends in its first input', async () => {
    server = await servingCalls([]);

    const started = await startedRunOf(server, 'quick');

    expect(started).toMatchObject({ status: 200, body: { status: 'succeeded', output: { quick: true } } });
  });
});

describe('workflows that call workflows, over HTTP', () => {
  it('reach eight calls deep: the ninth start is refused, and the run that asked for it fails', async () => {
    server = await servingCalls([]);

    const settled = await settledRunOf('deep');
    const deep = await until(() => runsOf(server, 'deep'), ended);

    expect(settled).toMatchObject({ body: { status: 'rejected' } });
    expect(JSON.stringify(settled.body)).toContain('more than the 8 a run may');
    expect(deep).toHaveLength(9);
  });

  it('keep no more calls open under one run than the server allows, refusing the next', async () => {
    server = await servingCalls([], { WORKFLOW_MAX_OPEN_CALLS: '2' });

    const settled = await settledRunOf('wide');
    const pending = await until(() => runsOf(server, 'pending'), ended);

    expect(JSON.stringify(settled.body)).toContain('already wait for 2 calls');
    expect(pending.map(({ status, rejection }) => [status, rejection?.kind])).toEqual([
      ['rejected', 'parent_ended'],
      ['rejected', 'parent_ended'],
    ]);
  });

  it('release the call while the run it waits for runs, so one call at once still lets many runs wait', async () => {
    server = await servingCalls([], { WORKFLOW_NESTED_RUNS: '1' });

    await startedRunOf(server, 'waiting');
    await startedRunOf(server, 'waiting');
    const pending = await until(
      () => runsOf(server, 'pending'),
      (runs) => runs.length === 2,
    );

    expect(pending).toMatchObject([{ status: 'started' }, { status: 'started' }]);
  });
});
