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
