import { RateLimited } from '@on.auto/reasoning';
import { answers, jsonResult, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

let server: ReasoningServer;

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ type: Schema.String, data: Schema.Struct({ number: Schema.optionalKey(Schema.Number) }) }),
    ),
  }),
);

function numberedIn(body: unknown): readonly (readonly [string, number | null])[] {
  return decodeHistory(body).events.map(({ type, data }) => [type, data.number ?? null]);
}

async function serving(...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  server = await servingReasoning(replies);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'verdict', source: verdict } });
  return server;
}

function running(name: string, body: object) {
  return server.call('POST', `${alpha}/definitions/reasoning/${name}/run`, { body });
}

afterEach(async () => {
  await server.stop();
});

describe('running a reasoning function definition over HTTP', () => {
  it('answers with the run and the text of the model', async () => {
    await serving(answers(textResult('Profits rose.')));

    expect(await running('summary', { input: { text: 'the quarter' } })).toMatchObject({
      status: 200,
      body: { type: 'reasoning', name: 'summary', definition_version: 1, status: 'succeeded', output: 'Profits rose.' },
    });
  });

  it('answers with the JSON value of a JSON definition', async () => {
    await serving(answers(jsonResult({ approve: true })));

    expect(await running('verdict', { input: { expense: 'a dinner' } })).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: { approve: true } },
    });
  });
});

const limited: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: null }),
  );

describe('a run of a reasoning function that ended unavailable, over HTTP', () => {
  it('runs again under its id a run that ended unavailable, numbering its model calls after the first', async () => {
    await serving(limited, answers(textResult('Profits rose.')));
    const first = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
    const again = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    expect([first.status, again.status]).toEqual([503, 200]);
    expect(numberedIn(history.body)).toEqual([
      ['run_started', null],
      ['model_call_started', 1],
      ['model_call_failed', 1],
      ['run_rejected', null],
      ['run_started', null],
      ['model_call_started', 2],
      ['model_call_answered', 2],
      ['run_succeeded', null],
    ]);
  });
});

describe('the runs of a reasoning function definition over HTTP', () => {
  it('rejects an input that does not match the input schema with 422, under /input', async () => {
    await serving();

    expect(await running('summary', { input: { text: 7 } })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/input/text', detail: 'text: expected text.' }] },
    });
    expect(server.modelCalls()).toBe(0);
  });

  it('answers a retry with the same run id from the record, without calling the model again', async () => {
    await serving(answers(textResult('Profits rose.')));
    const first = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
    const retried = await running('summary', { input: { text: 'the quarter' }, run_id: runId });

    expect(first).toMatchObject({ status: 200, body: { run_id: runId, output: 'Profits rose.' } });
    expect(retried.body).toEqual(first.body);
    expect(server.modelCalls()).toBe(1);
  });

  it('shows the record of the run with get_run', async () => {
    await serving(answers(textResult('Profits rose.', { response_id: 'msg_01', duration_ms: 420 })));
    await running('summary', { input: { text: 'the quarter' }, run_id: runId });

    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      status: 200,
      body: {
        run_id: runId,
        status: 'succeeded',
        output: 'Profits rose.',
        record: {
          model: { requested: 'anthropic/claude-sonnet-4-5', resolved: 'scripted/model', answered: 'model' },
          settings: { max_output_tokens: 1024 },
          output_format: 'text',
          finish_reason: 'stop',
          response_id: 'msg_01',
          duration_ms: 420,
          prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter', truncated: false },
        },
      },
    });
  });
});
