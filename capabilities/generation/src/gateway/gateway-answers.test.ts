import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredByKind,
  answeredWith,
  fakeGateway,
  fakeGatewaySettings,
  spokenBytes,
  type GatewayAnswering,
} from '../testing/index.ts';
import { generatedBy, type GatewayCall } from './gateway-call.ts';
import type { GenerationRequest } from './generation-gateway.ts';

const image: GenerationRequest = {
  kind: 'image',
  model: 'openai/gpt-image-2',
  prompt: 'A lighthouse at dawn',
  parameters: { size: '1024x1024', quality: 'high' },
  references: [],
};

const speech: GenerationRequest = {
  kind: 'audio',
  model: 'openai/gpt-4o-mini-tts',
  prompt: 'Welcome',
  parameters: { voice: 'coral', format: 'wav' },
  references: [],
};

const mebibyte = 1_048_576;

function callOn(answering: GatewayAnswering): GatewayCall {
  return { gateway: fakeGatewaySettings, fetch: fakeGateway(answering).fetch };
}

function refusalOf(call: GatewayCall, request: GenerationRequest, most = mebibyte) {
  return Effect.runPromise(Effect.flip(generatedBy(call, request, most)));
}

async function refused(answering: GatewayAnswering, request: GenerationRequest = image) {
  const { detail, kind } = await refusalOf(callOn(answering), request);
  return { detail, kind };
}

function answeredAs(bytes: Readonly<Buffer>): GatewayAnswering {
  return () => Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
}

function typedAs(contentType: string): GatewayAnswering {
  return () => new Response(spokenBytes, { headers: { 'content-type': contentType } });
}

function webp(riff: string): Readonly<Buffer> {
  return Buffer.concat([Buffer.from(riff, 'latin1'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1')]);
}

describe('an answer the gateway gave and the runtime then refuses', () => {
  it('carries the cost the gateway answered and the record of the call, which a refusal before an answer does not', async () => {
    const recorded = { ...callOn(answeredByKind()), record: { model: 'gateway/openai/gpt-image-2' } };

    expect([
      (await refusalOf(callOn(answeredByKind()), image, 10)).record,
      (
        await refusalOf(
          callOn(() => Response.json({ data: [] })),
          image,
        )
      ).record,
      (await refusalOf(callOn(typedAs('text/html')), speech)).record,
      (await refusalOf(callOn(answeredWith(500, {})), image)).record,
      (await refusalOf(recorded, image, 10)).record,
    ]).toEqual([{ cost_usd: 0.04 }, {}, {}, undefined, { model: 'gateway/openai/gpt-image-2', cost_usd: 0.04 }]);
  });

  it('reads a WebP by its RIFF header and its WEBP mark both, and refuses bytes that carry the mark alone', async () => {
    const read = await Effect.runPromise(generatedBy(callOn(answeredAs(webp('RIFF'))), image, mebibyte));

    expect(read.mediaType).toBe('image/webp');
    expect(await refused(answeredAs(webp('XXXX')))).toEqual({
      detail: 'The answer of the gateway gateway held no image; try again',
      kind: undefined,
    });
  });

  it('is unavailable where the gateway answers a type that is no audio, naming the type where it reads as one', async () => {
    expect([
      await refused(typedAs('application/octet-stream'), speech),
      await refused(typedAs('text/html; charset=utf-8'), speech),
      await refused(typedAs('not a type'), speech),
    ]).toEqual([
      {
        detail: 'The gateway gateway answered as application/octet-stream, which is no audio; try again',
        kind: undefined,
      },
      { detail: 'The gateway gateway answered as text/html, which is no audio; try again', kind: undefined },
      { detail: 'The gateway gateway answered in a type that is no audio; try again', kind: undefined },
    ]);
  });
});

const outOfBudget = (status: number) => ({
  detail: `The gateway gateway refused the request for its own budget or quota (HTTP ${status}); try again once it has room`,
  kind: undefined,
});

describe('a gateway that refuses for its own budget or quota', () => {
  it('is unavailable, naming the budget or the quota of the gateway, whatever its status', async () => {
    const answers = [
      answeredWith(400, {
        error: { message: 'Budget has been exceeded! Current cost: 5.01, Max budget: 5.0', type: 'budget_exceeded' },
      }),
      answeredWith(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }),
      answeredWith(400, { error: { message: 'Insufficient quota for this key' } }),
      answeredWith(402, {}),
    ];

    expect(await Promise.all(answers.map((answer) => refused(answer)))).toEqual([
      outOfBudget(400),
      outOfBudget(429),
      outOfBudget(400),
      outOfBudget(402),
    ]);
  });
});
