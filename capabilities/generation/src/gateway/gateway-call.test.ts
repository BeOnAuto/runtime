import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredByKind,
  answeredWith,
  fakeGateway,
  fakeGatewaySettings,
  onePixelPng,
  spokenBytes,
  type AskedOfTheGateway,
  type GatewayAnswering,
} from '../testing/index.ts';
import { generatedBy, type GatewayCall } from './gateway-call.ts';
import type { GatewayFetch, GenerationRequest } from './generation-gateway.ts';

const image: GenerationRequest = {
  kind: 'image',
  model: 'openai/gpt-image-1',
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

function callOn(answering: GatewayAnswering, settings = fakeGatewaySettings) {
  const gateway = fakeGateway(answering);
  const call: GatewayCall = { gateway: settings, fetch: gateway.fetch };
  return { gateway, call };
}

function generated(call: GatewayCall, request: GenerationRequest, most = mebibyte) {
  return Effect.runPromise(generatedBy(call, request, most));
}

async function refused(call: GatewayCall, request: GenerationRequest, most = mebibyte) {
  const { detail, kind } = await Effect.runPromise(Effect.flip(generatedBy(call, request, most)));
  return { detail, kind };
}

function refusedOf(answering: GatewayAnswering) {
  return refused(callOn(answering).call, image);
}

function sentOf({ path, search, body, files, headers }: AskedOfTheGateway) {
  return { path, search, body, files, auth: headers['authorization'], team: headers['x-team'] };
}

const tooLongARefusal: GatewayAnswering = () => new Response('x'.repeat(70_000), { status: 400 });

const noBody: GatewayAnswering = () => new Response(null, { status: 502 });

const neverAnswers: GatewayFetch = ({ signal }) =>
  new Promise((_answer, refuse: (error: Readonly<Error>) => void) => {
    signal.addEventListener('abort', () => {
      refuse(new DOMException('The gateway took too long', 'TimeoutError'));
    });
  });

const moderated = {
  detail:
    'The provider behind the gateway gateway refused the request under its moderation; change the prompt, the input or the references',
  kind: 'blocked_by_moderation',
};

describe('an image asked of the gateway', () => {
  it('posts the model, the prompt and the parameters to /images/generations, with the key, the headers and the query of the gateway', async () => {
    const { gateway, call } = callOn(answeredByKind());

    expect(await generated(call, { ...image, parameters: { aspect: '16:9' } })).toEqual({
      bytes: onePixelPng,
      mediaType: 'image/png',
      costUsd: 0.04,
    });
    expect(gateway.asked().map((asked) => sentOf(asked))).toEqual([
      {
        path: '/v1/images/generations',
        search: '?region=eu',
        body: { model: 'openai/gpt-image-1', prompt: 'A lighthouse at dawn', n: 1, aspect_ratio: '16:9' },
        files: [],
        auth: 'Bearer gateway-test-key',
        team: 'team-7',
      },
    ]);
  });
});

describe('an image asked of the gateway from references', () => {
  it('posts its references as files to /images/edits, with no key where the gateway names none', async () => {
    const { gateway, call } = callOn(answeredByKind(), {
      ...fakeGatewaySettings,
      api_key: null,
      query_params: new Map(),
    });
    const references = [
      { mediaType: 'image/png', bytes: onePixelPng },
      { mediaType: 'image/x-unknown', bytes: new Uint8Array([1, 2]) },
    ];

    await generated(call, { ...image, references });

    expect(gateway.asked().map((asked) => sentOf(asked))).toEqual([
      {
        path: '/v1/images/edits',
        search: '',
        body: {
          model: 'openai/gpt-image-1',
          prompt: 'A lighthouse at dawn',
          n: '1',
          size: '1024x1024',
          quality: 'high',
        },
        files: [
          { name: 'reference-1.png', type: 'image/png', bytes: onePixelPng.byteLength },
          { name: 'reference-2.bin', type: 'image/x-unknown', bytes: 2 },
        ],
        auth: undefined,
        team: 'team-7',
      },
    ]);
  });
});

describe('the cost and the bytes of an image the gateway answers', () => {
  it('keeps no cost where the gateway names no cost header or answers none it can read', async () => {
    const unnamed = callOn(answeredByKind(), { ...fakeGatewaySettings, cost_header: null });
    const unreadable = callOn(answeredByKind('free'));
    const empty = callOn(answeredByKind(' '));
    const plain = { bytes: onePixelPng, mediaType: 'image/png' };

    expect([
      await generated(unnamed.call, image),
      await generated(unreadable.call, image),
      await generated(empty.call, image),
    ]).toEqual([plain, plain, plain]);
  });

  it('is refused where the answer holds no image, an image of no kind it knows, or one larger than the runtime keeps', async () => {
    const noImage = callOn(() => Response.json({ data: [] }));
    const notAnImage = callOn(() =>
      Response.json({ data: [{ b64_json: Buffer.from('plain text').toString('base64') }] }),
    );
    const large = callOn(answeredByKind());
    const huge = callOn(() => Response.json({ data: [{ b64_json: 'A'.repeat(1_200_000) }] }));
    const unread = { detail: 'The answer of the gateway gateway held no image; try again', kind: undefined };
    const tooLarge = {
      detail: 'The image the model made is larger than the 10 bytes this runtime keeps of one image',
      kind: 'oversized',
    };

    expect([
      await refused(noImage.call, image),
      await refused(notAnImage.call, image),
      await refused(large.call, image, 10),
      await refused(huge.call, image, 10),
    ]).toEqual([unread, unread, tooLarge, tooLarge]);
  });
});

describe('audio asked of the gateway', () => {
  it('posts the prompt as the input to /audio/speech with the voice and the format, and keeps the media type it answers', async () => {
    const { gateway, call } = callOn(answeredByKind('0.002'));

    expect(await generated(call, speech)).toEqual({ bytes: spokenBytes, mediaType: 'audio/mpeg', costUsd: 0.002 });
    expect(gateway.asked().map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: '/v1/audio/speech',
        body: { model: 'openai/gpt-4o-mini-tts', input: 'Welcome', voice: 'coral', response_format: 'wav' },
      },
    ]);
  });

  it('takes the media type of its format where the gateway names none, and refuses audio larger than the runtime keeps', async () => {
    const bare = callOn(() => new Response(spokenBytes));
    const blank = callOn(() => new Response(spokenBytes, { headers: { 'content-type': '; charset=utf-8' } }));

    expect([
      await generated(blank.call, speech),
      await generated(bare.call, { ...speech, parameters: { voice: 'coral', format: 'ogg-ish' } }),
    ]).toEqual([
      { bytes: spokenBytes, mediaType: 'audio/wav' },
      { bytes: spokenBytes, mediaType: 'audio/mpeg' },
    ]);
    expect(await refused(bare.call, speech, 4)).toEqual({
      detail: 'The audio the model made is larger than the 4 bytes this runtime keeps of one audio',
      kind: 'oversized',
    });
  });

  it('sends a duration where the function asks one', async () => {
    const { gateway, call } = callOn(answeredByKind());

    await generated(call, { ...speech, parameters: { voice: 'wind', format: 'flac', duration: 12 } });

    expect(gateway.asked()[0]?.body).toEqual({
      model: 'openai/gpt-4o-mini-tts',
      input: 'Welcome',
      voice: 'wind',
      response_format: 'flac',
      duration: 12,
    });
  });
});

describe('what the provider refuses under its moderation', () => {
  it('is blocked by moderation where the provider says so by its code, its type or its words', async () => {
    expect([
      await refusedOf(
        answeredWith(400, { error: { code: 'moderation_blocked', message: 'Your request was rejected' } }),
      ),
      await refusedOf(answeredWith(400, { error: { type: 'content_policy_violation' } })),
      await refusedOf(answeredWith(422, { error: { message: 'litellm.ContentPolicyViolationError: refused' } })),
      await refusedOf(answeredWith(400, { error: { message: 'Rejected by the safety system' } })),
    ]).toEqual([moderated, moderated, moderated, moderated]);
  });
});

describe('a request the gateway does not take', () => {
  it('is a definition to update, naming the error code it gives when one is plain', async () => {
    expect([
      await refusedOf(answeredWith(400, { error: { code: 'invalid_size', message: 'no' } })),
      await refusedOf(answeredWith(404, { error: { code: 'not a plain code!' } })),
      await refusedOf(() => new Response('not json', { status: 400 })),
    ]).toEqual([
      {
        detail:
          'The gateway gateway answered HTTP 400: the request was not accepted, with the error code invalid_size; update the generation function definition',
        kind: 'unworkable',
      },
      {
        detail:
          'The gateway gateway answered HTTP 404: the model was not found; update the generation function definition',
        kind: 'unworkable',
      },
      {
        detail:
          'The gateway gateway answered HTTP 400: the request was not accepted; update the generation function definition',
        kind: 'unworkable',
      },
    ]);
  });
});

describe('a gateway that cannot serve the request now', () => {
  it('is unavailable for its credentials, its rate, a failure of its own or a redirect it does not follow, and reads no more of a refusal than it may', async () => {
    const answers = [401, 403, 429, 500, 503, 408, 307].map((status) => answeredWith(status, {}));

    const failures = await Promise.all([...answers, tooLongARefusal, noBody].map((answer) => refusedOf(answer)));

    expect(failures).toMatchObject([
      { detail: 'The gateway gateway rejected the credentials (HTTP 401)' },
      { detail: 'The gateway gateway rejected the credentials (HTTP 403)' },
      { detail: 'The gateway gateway is limiting the rate of requests; try again later' },
      { detail: 'The gateway gateway could not serve the request (HTTP 500); try again later' },
      { detail: 'The gateway gateway could not serve the request (HTTP 503); try again later' },
      { detail: 'The gateway gateway could not serve the request (HTTP 408); try again later' },
      {
        detail:
          'The gateway gateway answered a redirect (HTTP 307), which this runtime does not follow, so its address may be wrong',
      },
      {
        detail:
          'The gateway gateway answered HTTP 400: the request was not accepted; update the generation function definition',
      },
      { detail: 'The gateway gateway could not serve the request (HTTP 502); try again later' },
    ]);
  });

  it('is unavailable where the gateway cannot be reached or does not answer in time', async () => {
    const unreached: GatewayCall = {
      gateway: fakeGatewaySettings,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    };
    const slow: GatewayCall = { gateway: fakeGatewaySettings, fetch: neverAnswers, answerMs: 5 };

    expect([await refused(unreached, image), await refused(slow, image)]).toEqual([
      { detail: 'The gateway gateway could not be reached; try again later', kind: undefined },
      { detail: 'The gateway gateway did not answer within 0.005 seconds; try again later', kind: undefined },
    ]);
  });
});
