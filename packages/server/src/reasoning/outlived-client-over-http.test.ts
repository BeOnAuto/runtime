import { setTimeout } from 'node:timers/promises';

import { textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const timeForTheServerToSeeItGone = 300;

const asked = { input: { text: 'the quarter' }, run_id: runId };

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function givenUp(): { readonly gaveUp: Promise<unknown>; readonly giveUp: () => void } {
  const givingUp = new AbortController();
  const gaveUp: Promise<unknown> = fetch(`${server.origin}${alpha}/definitions/reasoning/summary/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(asked),
    signal: givingUp.signal,
  }).catch((error: unknown) => error);
  return {
    gaveUp,
    giveUp: () => {
      givingUp.abort();
    },
  };
}

describe('a run whose client goes away while the model answers', () => {
  it('outlives its client: the model answers, the run records its result, and a retry is given it', async () => {
    const answering = Promise.withResolvers<void>();
    const heldUntilReleased: ScriptedReply = () =>
      Effect.promise(() => answering.promise).pipe(Effect.as(textResult('Profits rose.')));
    server = await servingReasoning([heldUntilReleased]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });

    const client = givenUp();
    await until(
      () => server.modelCalls(),
      (calls) => calls > 0,
    );
    client.giveUp();
    await setTimeout(timeForTheServerToSeeItGone);
    const whileLive = server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
    answering.resolve();
    const retried = await whileLive;
    const after = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    expect(await client.gaveUp).toMatchObject({ name: 'AbortError' });
    expect(retried).toMatchObject({
      status: 200,
      body: { run_id: runId, status: 'succeeded', output: 'Profits rose.' },
    });
    expect(after.body).toEqual(retried.body);
    expect(decodeHistory(history.body).events.map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(server.modelCalls()).toBe(1);
  });
});

const neverAnswering: ScriptedReply = () => Effect.never;

describe('a run whose client went away, cancelled while the model answers', () => {
  it('is stopped by cancel_run, its model call ended as interrupted, ends cancelled as asked, the model called once', async () => {
    server = await servingReasoning([neverAnswering]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });

    const client = givenUp();
    await until(
      () => server.modelCalls(),
      (calls) => calls > 0,
    );
    client.giveUp();
    await setTimeout(timeForTheServerToSeeItGone);
    const cancelled = await server.call('POST', `${alpha}/runs/${runId}/cancel`, { body: { reason: 'Not needed' } });
    const retried = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    expect(cancelled).toMatchObject({
      status: 200,
      body: {
        run_id: runId,
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
      },
    });
    expect(retried).toMatchObject({ status: 409, body: { reason: 'cancelled', kind: 'requested' } });
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
