import { setTimeout } from 'node:timers/promises';

import { connectMcp, withMcpSession } from '@on.auto/api/testing';
import type { ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const timeForTheServerToSeeItGone = 300;

const neverAnswering: ScriptedReply = () => Effect.never;

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('a reasoning run whose MCP client goes away while the model answers', () => {
  it('goes on without its client, and cancel_run over MCP stops it, its model call ended, the model called once', async () => {
    server = await servingReasoning([neverAnswering]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    const connection = { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} };
    const leaving = await connectMcp('current revision', connection);

    const leftBehind = leaving
      .callTool('run_definition', { type: 'reasoning', name: 'summary', input: { text: 'the quarter' }, run_id: runId })
      .catch((error: unknown) => error);
    await until(
      () => server.modelCalls(),
      (calls) => calls > 0,
    );
    await leaving.close();
    await leftBehind;
    await setTimeout(timeForTheServerToSeeItGone);
    const { going, cancelled } = await withMcpSession('current revision', connection, async (session) => ({
      going: await session.callTool('get_run', { run_id: runId }),
      cancelled: await session.callTool('cancel_run', { run_id: runId, reason: 'Not needed' }),
    }));
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    expect(going.structuredContent).toMatchObject({ run_id: runId, status: 'started' });
    expect(cancelled.structuredContent).toMatchObject({
      run_id: runId,
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
    });
    expect(decodeHistory(history.body).events.map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_cancel_requested',
      'model_call_failed',
      'run_rejected',
    ]);
    expect(server.modelCalls()).toBe(1);
  });
});
