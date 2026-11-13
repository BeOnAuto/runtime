import { createHash } from 'node:crypto';

import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const input = { notes: 'n'.repeat(3000) };

const inputText = JSON.stringify(input);

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) })),
  }),
);

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Sum up the notes.'].join('\n');

async function startedWith(environment: Readonly<Record<string, string>>) {
  const server = await servingReasoning([answers(textResult('A short day.'))], environment);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  const run = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
    body: { input, run_id: runId },
  });
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const started = decodeEvents(history.body).events.find(({ type }) => type === 'run_started');
  return { run: run.body, started: started?.data ?? {} };
}

describe('a server given the payload settings, over HTTP', () => {
  it('keeps a run’s input of 3012 bytes by its digest and size past a threshold of 2048, and runs it whole', async () => {
    const { run, started } = await startedWith({ PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' });

    expect(run).toMatchObject({ status: 'succeeded' });
    expect(started).toMatchObject({
      input_sha256: createHash('sha256').update(inputText).digest('hex'),
      input_bytes: inputText.length,
    });
  });

  it('keeps the same input in its record at the default threshold of 16384, and with offloading off', async () => {
    const atTheDefault = await startedWith({});
    const switchedOff = await startedWith({ PAYLOAD_OFFLOADING: 'false', PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' });

    expect([atTheDefault.run, switchedOff.run]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(
      [atTheDefault.started, switchedOff.started].map((data) => [
        Object.hasOwn(data, 'input_sha256'),
        data['input_bytes'],
      ]),
    ).toEqual([
      [false, inputText.length],
      [false, inputText.length],
    ]);
  });
});
