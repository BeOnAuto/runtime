import { setTimeout } from 'node:timers/promises';

import { textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const timeForTheRetryToArrive = 300;

describe('two requests for one run at once, in one server', () => {
  it('make one attempt of it, whose answer both are given, so that a retry of a client is answered once', async () => {
    const answering = Promise.withResolvers<void>();
    const heldUntilAnswered: ScriptedReply = () =>
      Effect.promise(() => answering.promise).pipe(Effect.as(textResult('Profits rose.')));
    const server = await servingReasoning([heldUntilAnswered]);
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    const request = { body: { input: { text: 'the quarter' }, run_id: runId } };

    const first = server.call('POST', `${alpha}/definitions/reasoning/summary/run`, request);
    await until(
      () => server.modelCalls(),
      (calls) => calls > 0,
    );
    const retry = server.call('POST', `${alpha}/definitions/reasoning/summary/run`, request);
    await setTimeout(timeForTheRetryToArrive);
    answering.resolve();
    const answers = await Promise.all([first, retry]);

    expect(answers.map(({ status, body }) => [status, body])).toEqual([
      [200, expect.objectContaining({ run_id: runId, status: 'succeeded', output: 'Profits rose.' })],
      [200, answers[0]?.body],
    ]);
    expect(server.modelCalls()).toBe(1);
  });
});
