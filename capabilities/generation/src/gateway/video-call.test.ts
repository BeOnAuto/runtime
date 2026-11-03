import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedHandle, fakeGateway, fakeGatewaySettings, onePixelPng, type GatewayAnswering } from '../testing/index.ts';
import type { GatewayCall } from './gateway-call.ts';
import { gatewayRequestOf } from './gateway-requests.ts';
import type { GatewayFetch, GenerationRequest } from './generation-gateway.ts';
import { videoAskedOf, videoFetchedOf, videoStandingOf } from './video-call.ts';

const flight: GenerationRequest = {
  kind: 'video',
  model: 'example/short-film',
  prompt: 'A drone flight',
  parameters: { size: '720x1280', duration: 8 },
  references: [],
};

const spent = { model: 'gateway/example/short-film', own_key: true };

function callOn(answering: GatewayAnswering): GatewayCall {
  return { gateway: fakeGatewaySettings, fetch: fakeGateway(answering).fetch, record: spent };
}

async function refusedAsking(call: GatewayCall): Promise<string> {
  return (await Effect.runPromise(Effect.flip(videoAskedOf(call, flight)))).detail;
}

const unreachable: GatewayFetch = () => Promise.reject(new Error('The gateway is not reachable'));

const neverAnswers: GatewayFetch = ({ signal }) =>
  new Promise((_answer, refuse: (error: Readonly<Error>) => void) => {
    signal.addEventListener('abort', () => {
      refuse(new DOMException('The gateway took too long', 'TimeoutError'));
    });
  });

describe('a video asked of the gateway', () => {
  it('sends no seconds where the request names none, and the references as files of input_reference', async () => {
    const gateway = fakeGateway(() => Response.json({}));
    const signal = new AbortController().signal;
    const referring: GenerationRequest = {
      ...flight,
      parameters: { size: '1280x720' },
      references: [{ mediaType: 'image/png', bytes: onePixelPng }],
    };

    await gateway.fetch(gatewayRequestOf(fakeGatewaySettings, { ...flight, parameters: {} }, signal));
    await gateway.fetch(gatewayRequestOf(fakeGatewaySettings, referring, signal));

    expect(gateway.asked().map(({ path, body, files }) => ({ path, body, files }))).toEqual([
      { path: '/v1/videos', body: { model: 'example/short-film', prompt: 'A drone flight' }, files: [] },
      {
        path: '/v1/videos',
        body: { model: 'example/short-film', prompt: 'A drone flight', size: '1280x720' },
        files: [{ name: 'reference-1.png', type: 'image/png', bytes: onePixelPng.byteLength }],
      },
    ]);
  });

  it('is unavailable where the gateway cannot be reached or does not answer in time', async () => {
    const refusals = [
      await refusedAsking({ gateway: fakeGatewaySettings, fetch: unreachable }),
      await refusedAsking({ gateway: fakeGatewaySettings, fetch: neverAnswers, answerMs: 5 }),
    ];

    expect(refusals).toEqual([
      'The gateway gateway could not be reached; try again later',
      'The gateway gateway did not answer within 0.005 seconds; try again later',
    ]);
  });
});

function standingOf(answering: GatewayAnswering) {
  return Effect.runPromise(videoStandingOf(callOn(answering), askedHandle));
}

function progressOf(progress: object) {
  return standingOf(() => Response.json({ id: askedHandle, status: 'queued', ...progress }));
}

describe('how a video stands, as the gateway says', () => {
  it('reads a progress from 0 to 100, rounded, and none where the gateway says none or one out of that range', async () => {
    const said = [
      await progressOf({ progress: 42.6 }),
      await progressOf({}),
      await progressOf({ progress: null }),
      await progressOf({ progress: 140 }),
      await progressOf({ progress: -1 }),
    ];

    expect(said).toEqual([
      { standing: 'making', progress: 43 },
      { standing: 'making', progress: null },
      { standing: 'making', progress: null },
      { standing: 'making', progress: null },
      { standing: 'making', progress: null },
    ]);
  });

  it('is unanswered where the gateway answers more than it reads, or cannot be reached', async () => {
    expect([
      await standingOf(() => new Response(`{"id":"${askedHandle}","status":"queued","pad":"${'x'.repeat(70_000)}"}`)),
      await Effect.runPromise(videoStandingOf({ gateway: fakeGatewaySettings, fetch: unreachable }, askedHandle)),
    ]).toEqual([{ standing: 'unanswered' }, { standing: 'unanswered' }]);
  });
});

describe('the bytes of a video, as the gateway answers them', () => {
  it('are unanswered where the gateway cannot be reached', async () => {
    expect(
      await Effect.runPromise(videoFetchedOf({ gateway: fakeGatewaySettings, fetch: unreachable }, askedHandle, 100)),
    ).toEqual({ unanswered: true });
  });

  it('are asked at the address of the video, its id written as one part of the path', async () => {
    const gateway = fakeGateway(
      () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'video/webm' } }),
    );

    const fetched = await Effect.runPromise(
      videoFetchedOf({ gateway: fakeGatewaySettings, fetch: gateway.fetch }, 'video/one?two', 100),
    );

    expect([fetched, gateway.asked().map(({ path, search }) => ({ path, search }))]).toEqual([
      { fetched: { bytes: Buffer.from([1, 2]), mediaType: 'video/webm' } },
      [{ path: '/v1/videos/video%2Fone%3Ftwo/content', search: '?region=eu' }],
    ]);
  });
});
