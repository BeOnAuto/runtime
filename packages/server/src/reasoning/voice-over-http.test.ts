import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const gateway = {
  MODEL_GATEWAYS: JSON.stringify([
    { name: 'gateway', base_url: 'https://llm.internal.example/v1', cost_header: 'x-litellm-response-cost' },
  ]),
};

const voiced = { ...gateway, VOICE_MODEL: 'gateway/xai/scribe_v2' };

const recording = { audio: Buffer.from([26, 69, 223, 163]).toString('base64'), type: 'audio/webm', seconds: 4 };

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function transcribing(): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      Response.json({ text: ' Close the week. ' }, { headers: { 'x-litellm-response-cost': '0.000111' } }),
    );
}

describe('get_voice over HTTP', () => {
  it('answers GET /v1/orgs/{org}/voice with the voice model the settings name', async () => {
    server = await servingReasoning([], voiced);

    expect(await server.call('GET', '/v1/orgs/acme/voice')).toMatchObject({
      status: 200,
      body: { model: 'gateway/xai/scribe_v2' },
    });
  });

  it('answers null where no voice model is set', async () => {
    server = await servingReasoning([], gateway);

    expect(await server.call('GET', '/v1/orgs/acme/voice')).toMatchObject({ status: 200, body: { model: null } });
  });
});

describe('transcribe over HTTP', () => {
  it('answers POST /v1/orgs/{org}/voice/transcriptions with the text the voice model wrote out', async () => {
    server = await servingReasoning([], voiced, transcribing());

    const transcribed = await server.call('POST', '/v1/orgs/acme/voice/transcriptions', { body: recording });

    expect(transcribed).toMatchObject({ status: 200, body: { text: 'Close the week.' } });
  });

  it('is refused as unavailable where the runtime has no voice model', async () => {
    server = await servingReasoning([], gateway, transcribing());

    const refused = await server.call('POST', '/v1/orgs/acme/voice/transcriptions', { body: recording });

    expect(refused).toMatchObject({ status: 503, body: { detail: 'This runtime has no voice model' } });
  });
});
