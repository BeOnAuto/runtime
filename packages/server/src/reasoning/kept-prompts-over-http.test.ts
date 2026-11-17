import { createHash } from 'node:crypto';

import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const reads = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Read: {{ input.text }}',
].join('\n');

const text = 't'.repeat(17_000);

const shortText = 's'.repeat(3000);

function promptOf(given: string) {
  return { instructions: 'Be brief.', message: `Read: ${given}`, truncated: false };
}

function keptPromptOf(given: string) {
  const written = JSON.stringify(promptOf(given));
  return {
    prompt_sha256: createHash('sha256').update(written).digest('hex'),
    prompt_bytes: Buffer.byteLength(written, 'utf8'),
  };
}

const prompt = promptOf(text);

const keptPrompt = keptPromptOf(text);

const RecordSchema = Schema.Record(Schema.String, Schema.Json);

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ record: RecordSchema }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String, data: RecordSchema })),
  }),
);

const decodeEvent = Schema.decodeUnknownSync(Schema.Struct({ data: RecordSchema }));

function servingOver(
  environment: Readonly<Record<string, string>>,
  keptOutside: boolean,
  ledger?: TemporaryLedger,
): Promise<ReasoningServer> {
  return servingReasoning([answers(textResult('Read.'))], environment, noNetwork, {
    keptOutside,
    ...(ledger === undefined ? {} : { ledger }),
  });
}

async function serving(environment: Readonly<Record<string, string>>, keptOutside: boolean): Promise<ReasoningServer> {
  const server = await servingOver(environment, keptOutside);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'reads', source: reads, diagram: 'none' },
  });
  return server;
}

async function ranAndReadBack(server: ReasoningServer, given = text) {
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
    body: { input: { text: given }, run_id: runId },
  });
  const read = await server.call('GET', `${alpha}/runs/${runId}`);
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const ending = decodeEvents(history.body).events.find(({ type }) => type === 'run_succeeded');
  const whole = await server.call('GET', `${alpha}/events/${ending?.id ?? 'none'}`);
  return {
    answered: decodeRun(ran.body).record,
    read: decodeRun(read.body).record,
    onAPage: ending?.data,
    whole: decodeEvent(whole.body).data['record'],
  };
}

async function ranWhileKeeping(store: Readonly<Record<string, string>>, ledger: TemporaryLedger): Promise<void> {
  const keeping = await servingOver(store, true, ledger);
  try {
    await keeping.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await keeping.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'reads', source: reads, diagram: 'none' },
    });
    await keeping.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
      body: { input: { text }, run_id: runId },
    });
  } finally {
    await keeping.stop();
  }
}

describe('a reasoning run whose prompt is past 16,384 bytes', () => {
  it('keeps the prompt outside its ending where the server keeps large values outside, and answers and shows the run as a server that keeps it inline does', async () => {
    const keeping = await ranAndReadBack(await serving({}, true));
    const inline = await ranAndReadBack(await serving({}, false));

    expect([keeping.answered['prompt'], keeping.read['prompt'], inline.read['prompt']]).toEqual([
      prompt,
      prompt,
      prompt,
    ]);
    expect(Object.keys(keeping.read)).toEqual(Object.keys(inline.read));
    expect(keeping.onAPage).toMatchObject({ record: keptPrompt });
    expect(keeping.onAPage).not.toHaveProperty('record.prompt');
    expect(keeping.whole).toMatchObject({ ...keptPrompt, prompt });
    expect(inline.onAPage).not.toHaveProperty('record.prompt_sha256');
    expect(inline.whole).toMatchObject({ prompt });
    expect(inline.whole).not.toHaveProperty('prompt_sha256');
  });

  it('reads a prompt kept while the switch was on once it is off, whole, so turning the switch off takes no prompt from a run', async () => {
    const store = {};
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await ranWhileKeeping(store, ledger);
    const switchedOff = await servingOver(store, false, ledger);
    onTestFinished(switchedOff.stop);

    const read = decodeRun((await switchedOff.call('GET', `${alpha}/runs/${runId}`)).body).record;
    const history = await switchedOff.call('GET', `${alpha}/runs/${runId}/history`);
    const ending = decodeEvents(history.body).events.find(({ type }) => type === 'run_succeeded');

    expect(read['prompt']).toEqual(prompt);
    expect(ending).toMatchObject({ data: { record: keptPrompt } });
  });
});

describe('a reasoning run under the payload size threshold the server is given', () => {
  it('keeps the prompt by the server’s payload size threshold, as it keeps an output: inline at 65,536 bytes, and by its digest past 2,048 for a prompt of 3 KB', async () => {
    const atTheCap = await ranAndReadBack(await serving({ PAYLOAD_SIZE_THRESHOLD_BYTES: '65536' }, true));
    const atTheFloor = await ranAndReadBack(await serving({ PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' }, true), shortText);

    expect(atTheCap.onAPage).not.toHaveProperty('record.prompt_sha256');
    expect(atTheCap.whole).toMatchObject({ prompt });
    expect(atTheFloor.onAPage).toMatchObject({ record: keptPromptOf(shortText) });
    expect(atTheFloor.read['prompt']).toEqual(promptOf(shortText));
  });
});
