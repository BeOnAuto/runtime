import { withMcpSession } from '@on.auto/api/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { ended, impatientTimeoutMs, runsOf, servingCalls, startedRunOf } from '../testing/servers/workflow-calls.ts';
import { runIdIn, settledRun, settledOverMcp } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function cancelOf(runId: string, body: object) {
  return server.call('POST', `${alpha}/runs/${runId}/cancel`, { body });
}

async function waitingRunOf(name: string): Promise<string> {
  const started = await startedRunOf(server, name);
  await until(
    () => runsOf(server, 'pending'),
    (runs) => runs.length === 1,
  );
  return runIdIn(started.body);
}

describe('a cancel of a workflow run, over HTTP', () => {
  it('ends it as cancelled, with who asked and why, and cancels the run it waits for as its parent ended', async () => {
    server = await servingCalls([]);
    const runId = await waitingRunOf('waiting');

    const cancelled = await cancelOf(runId, { reason: 'No longer needed' });
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);
    const pending = await until(() => runsOf(server, 'pending'), ended);
    const again = await cancelOf(runId, { reason: 'No longer needed' });

    expect(cancelled).toMatchObject({ status: 200, body: { run_id: runId, status: 'started' } });
    expect(settled).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested', detail: 'No longer needed' } },
    });
    expect(pending).toMatchObject([{ status: 'rejected', rejection: { kind: 'parent_ended' } }]);
    expect(again).toMatchObject({ status: 409, body: { reason: 'conflict' } });
  });

  it('reaches every run of a tree three levels deep', async () => {
    server = await servingCalls([]);
    const runId = await waitingRunOf('top');

    await cancelOf(runId, {});
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);
    const middle = await until(() => runsOf(server, 'middle'), ended);
    const pending = await until(() => runsOf(server, 'pending'), ended);

    expect(settled).toMatchObject({
      body: { rejection: { reason: 'cancelled', kind: 'requested', detail: 'Cancelled at the request of local' } },
    });
    expect([...middle, ...pending].map(({ rejection }) => rejection?.kind)).toEqual(['parent_ended', 'parent_ended']);
  });

  it('is cancelled by the timeout of the step that waits for it, as past its deadline', async () => {
    const clock = movedClock(Date.now());
    server = await servingCalls([], {}, clock);

    const started = await startedRunOf(server, 'impatient');
    await until(
      () => runsOf(server, 'pending'),
      (runs) => runs.length > 0,
    );
    clock.moveTo(clock.now() + impatientTimeoutMs);
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
    const pending = await until(() => runsOf(server, 'pending'), ended);

    expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    expect(pending).toMatchObject([{ status: 'rejected', rejection: { kind: 'deadline' } }]);
  });
});

describe('a cancel of a run that cannot be cancelled, over HTTP', () => {
  it('is a conflict for a run that ran within its call, and not found for a run the playbook does not have', async () => {
    server = await servingCalls([answers(textResult('Short.'))]);
    const ran = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
      body: { input: { text: 'long' } },
    });

    const ranAlready = await cancelOf(runIdIn(ran.body), {});
    const unknown = await cancelOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f', {});

    expect([ranAlready.status, unknown.status]).toEqual([409, 404]);
  });
});

describe('a cancel of a workflow run, over MCP', () => {
  it('is the tool cancel_run, whose run then ends as cancelled', async () => {
    server = await servingCalls([]);
    const runId = await waitingRunOf('waiting');

    const { cancelled, settled } = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => ({
        cancelled: await session.callTool('cancel_run', { run_id: runId, reason: 'Done' }),
        settled: await settledOverMcp(session, runId),
      }),
    );

    expect(cancelled.isError).not.toBe(true);
    expect(settled.structuredContent).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested', detail: 'Done' },
    });
  });
});
