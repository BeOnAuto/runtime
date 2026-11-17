import { describe, expect, it } from 'vitest';

import { fakeGatewaySettings, onePixelPng } from '../testing/index.ts';
import { gatewayRequestOf } from './gateway-requests.ts';
import type { GenerationRequest } from './generation-gateway.ts';

const referring: GenerationRequest = {
  kind: 'image',
  model: 'openai/gpt-image-2',
  prompt: 'The same lighthouse at dawn',
  parameters: {},
  references: [
    { mediaType: 'image/png', bytes: onePixelPng },
    { mediaType: 'image/png', bytes: onePixelPng },
  ],
};

describe('the form of an image asked of the gateway from references', () => {
  it('is OpenAI’s documented form of an edit, each reference a file of the form field image[]', async () => {
    const request = gatewayRequestOf(fakeGatewaySettings, referring, new AbortController().signal);

    const body = new TextDecoder('latin1').decode(await request.arrayBuffer());

    expect([body.split('name="image[]"; filename="').length - 1, body.includes('name="image";')]).toEqual([2, false]);
  });
});

function imageAskedOf(model: string, references: GenerationRequest['references']): Request {
  return gatewayRequestOf(
    fakeGatewaySettings,
    { kind: 'image', model, prompt: 'A lighthouse', parameters: {}, references },
    new AbortController().signal,
  );
}

describe('the image asked of a provider that answers an address unless asked for the bytes', () => {
  it('asks xAI for the bytes, with references or without, and OpenAI for nothing it answers anyway', async () => {
    const plain = await imageAskedOf('xai/grok-imagine-image-2.0', []).text();
    const edit = new TextDecoder('latin1').decode(
      await imageAskedOf('xai/grok-imagine-image-2.0', referring.references).arrayBuffer(),
    );
    const openAi = await imageAskedOf('openai/gpt-image-2', []).text();

    expect([
      plain.includes('"response_format":"b64_json"'),
      edit.includes('name="response_format"\r\n\r\nb64_json'),
      openAi.includes('response_format'),
    ]).toEqual([true, true, false]);
  });
});
