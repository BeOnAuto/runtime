import { createHash } from 'node:crypto';

import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

// Where a value moves out of its record is proven beside the mechanism: the threshold and the arm in
// operations/src/payloads/payload.test.ts, the prompt of a record under each threshold in
// definitions/src/payloads/payload-writing.test.ts, a kept prompt read back and the switch turned off in
// definitions/src/operations/kept-run-prompts.test.ts and kept-prompt-writes.test.ts, the keys of a content under
// its org in object-storage/src/testing/object-content-behaviour.ts. Here one run shows the server wires them.

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const reads = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Read: {{ input.text }}',
].join('\n');

const text = 's'.repeat(3000);

const prompt = { instructions: 'Be brief.', message: `Read: ${text}`, truncated: false };

const written = JSON.stringify(prompt);

const keptPrompt = {
  prompt_sha256: createHash('sha256').update(written).digest('hex'),
  prompt_bytes: Buffer.byteLength(written, 'utf8'),
};

const RecordSchema = Schema.Record(Schema.String, Schema.Json);

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ record: RecordSchema }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String, data: RecordSchema })),
  }),
);

const decodeEvent = Schema.decodeUnknownSync(Schema.Struct({ data: RecordSchema }));

async function endingOf(server: ReasoningServer) {
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const ending = decodeEvents(history.body).events.find(({ type }) => type === 'run_succeeded');
  const whole = await server.call('GET', `${alpha}/events/${ending?.id ?? 'none'}`);
  return { onAPage: ending?.data, whole: decodeEvent(whole.body).data['record'] };
}

describe('a reasoning run whose prompt is past the payload size threshold the server is given', () => {
  it('keeps the prompt by its digest in the fact that ends the run, and shows it whole in the run and the event', async () => {
    const server = await servingReasoning(
      [answers(textResult('Read.'))],
      { PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' },
      noNetwork,
      {
        keptOutside: true,
      },
    );
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'reads', source: reads, diagram: 'none' },
    });

    await server.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
      body: { input: { text }, run_id: runId },
    });
    const read = decodeRun((await server.call('GET', `${alpha}/runs/${runId}`)).body).record;
    const { onAPage, whole } = await endingOf(server);

    expect(read['prompt']).toEqual(prompt);
    expect(onAPage).toMatchObject({ record: keptPrompt });
    expect(onAPage).not.toHaveProperty('record.prompt');
    expect(whole).toMatchObject({ ...keptPrompt, prompt });
  });
});
