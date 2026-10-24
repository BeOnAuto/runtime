import { withMcpSession } from '@on.auto/api/testing';
import { OutputInvalid } from '@on.auto/reasoning';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

function usageOf(input: number, output: number) {
  return {
    input: { total: input, uncached: input, cache_read: 0, cache_write: 0 },
    output: { total: output, text: output, reasoning: null },
    total: input + output,
  };
}

const unusable = new OutputInvalid({
  detail: 'The answer is not JSON',
  provider: 'anthropic',
  finish_reason: 'stop',
  raw_finish_reason: 'end_turn',
  usage: usageOf(300, 20),
  issues: [],
});

const succeeded = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const rejected = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const decodeRecord = Schema.decodeUnknownSync(Schema.Struct({ record: Schema.Json }));

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function recordOf(runId: string): Promise<Schema.Json> {
  return decodeRecord((await server.call('GET', `${alpha}/runs/${runId}`)).body).record;
}

function historyOf(runId: string): Promise<unknown> {
  return server.call('GET', `${alpha}/runs/${runId}/history`).then(({ body }) => body);
}

describe('the history of a reasoning run rejected after its model was called', () => {
  it('shows the record the rejection kept, as the history of a run that succeeded does, over HTTP and MCP', async () => {
    server = await servingReasoning([
      answers(textResult('Profits rose.', { usage: usageOf(1200, 80) })),
      () => Effect.fail(unusable),
    ]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    const running = (runId: string, text: string) =>
      server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
        body: { input: { text }, run_id: runId },
      });
    await running(succeeded, 'the quarter');
    const rejecting = await running(rejected, 'the year');

    const histories = { succeeded: await historyOf(succeeded), rejected: await historyOf(rejected) };
    const overMcp = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) => session.callTool('list_playbook_events', { run_id: rejected, order: 'asc' }),
    );

    expect(rejecting).toMatchObject({ status: 503, body: { reason: 'unavailable' } });
    expect(histories).toMatchObject({
      succeeded: {
        events: [
          { type: 'run_started' },
          { type: 'model_call_started', data: { number: 1 } },
          { type: 'model_call_answered', data: { number: 1, usage: usageOf(1200, 80) } },
          { type: 'run_succeeded', data: { output: 'Profits rose.', record: await recordOf(succeeded) } },
        ],
      },
      rejected: {
        events: [
          { type: 'run_started' },
          { type: 'model_call_started', data: { number: 1 } },
          { type: 'model_call_failed', data: { number: 1, because: 'output_invalid', usage: usageOf(300, 20) } },
          { type: 'run_rejected', data: { reason: 'unavailable', record: await recordOf(rejected) } },
        ],
      },
    });
    expect(overMcp.structuredContent).toEqual(histories.rejected);
  });
});
