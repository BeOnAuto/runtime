import { createHash } from 'node:crypto';

import { contentAddressesUnder } from '@on.auto/identity';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { generationShippedRoots, readGenerationCatalog } from '../index.ts';
import {
  assetIdIn,
  assetIdOf,
  day,
  generationOfKept,
  keptDataOf,
  numberedHarness,
  ran,
  recordIn,
  runIdOf,
} from '../run-testing/run-outcomes.ts';
import {
  alpha,
  answeredByKind,
  audioSource,
  generationHarness,
  harnessStartsAt,
  imageSource,
  onePixelPng,
  sourceWith,
  spokenBytes,
} from '../testing/index.ts';

const pngDigest = createHash('sha256').update(onePixelPng).digest('hex');

const teapot = 'A studio photograph of a teapot on a white table.';

const shipped = Result.getOrThrow(await readGenerationCatalog(shippedFilesOnDisk(generationShippedRoots())));

function ownOrigin(): string {
  return 'http://127.0.0.1:5555';
}

describe('a run of a generation function that makes an image', () => {
  it('asks the gateway once with the prompt and the parameters, and answers the reference of the asset it keeps', async () => {
    const playbook = numberedHarness();
    await playbook.define('picture', imageSource);

    const outcome = await ran(playbook, 'picture', { product: 'a teapot' });

    expect(outcome).toMatchObject({
      output: {
        output: {
          id: assetIdOf(1),
          media_type: 'image/png',
          bytes: onePixelPng.byteLength,
          sha256: pngDigest,
          address: null,
          address_until: null,
        },
      },
    });
    expect(recordIn(outcome)).toEqual({
      model: 'gateway/openai/gpt-image-2',
      own_key: true,
      duration_ms: 0,
      cost_usd: 0.04,
    });
    expect(playbook.gateway.asked().map(({ body }) => body)).toEqual([
      { model: 'openai/gpt-image-2', prompt: teapot, n: 1, size: '1024x1024', quality: 'high' },
    ]);
  });

  it('asks for the first quality of the model where the document names none, and for none of a model that names none', async () => {
    const playbook = numberedHarness();
    await playbook.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2']));
    await playbook.define('square', sourceWith(['produces: image', 'model: gateway/example/square-image']));

    await ran(playbook, 'picture', {}, 1);
    await ran(playbook, 'square', {}, 2);

    expect(playbook.gateway.asked().map(({ body }) => body)).toEqual([
      { model: 'openai/gpt-image-2', prompt: 'A lighthouse at dawn.', n: 1, quality: 'auto' },
      { model: 'example/square-image', prompt: 'A lighthouse at dawn.', n: 1 },
    ]);
    expect(await playbook.factsOf(assetIdOf(1))).toMatchObject([
      { data: { made_by: { generation: { parameters: { quality: 'auto' } } } } },
    ]);
  });
});

describe('a run of a generation function over the catalogue the runtime ships', () => {
  it('asks for a low image of gpt-image-2.6-flare where the document names no quality, the first its entry names', async () => {
    const playbook = numberedHarness({ catalog: shipped });
    await playbook.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2.6-flare']));

    await ran(playbook, 'picture', {});

    expect(playbook.gateway.asked().map(({ body }) => body)).toEqual([
      { model: 'openai/gpt-image-2.6-flare', prompt: 'A lighthouse at dawn.', n: 1, quality: 'low' },
    ]);
  });
});

describe('the stream of the asset a run of a generation function keeps', () => {
  it('records the asset it keeps on a stream of its own, with what made it and until when it is kept', async () => {
    const playbook = numberedHarness();
    await playbook.define('picture', imageSource);
    await ran(playbook, 'picture', { product: 'a teapot' });

    expect(await playbook.factsOf(assetIdOf(1))).toEqual([
      {
        type: 'asset_kept',
        data: {
          media_type: 'image/png',
          bytes: onePixelPng.byteLength,
          sha256: pngDigest,
          kind: 'image',
          made_by: {
            generation: {
              model: 'gateway/openai/gpt-image-2',
              prompt: teapot,
              parameters: { size: '1024x1024', quality: 'high' },
              references: [],
              cost_usd: 0.04,
              own_key: true,
            },
          },
          expires_at: new Date(harnessStartsAt + 30 * day).toISOString(),
        },
        context: {
          at: new Date(harnessStartsAt).toISOString(),
          by: 'acme-admin',
          runId: runIdOf(1),
          definitionType: 'generation',
          definitionName: 'picture',
          definitionVersion: 1,
        },
      },
    ]);
  });
});

describe('the assets a playbook keeps', () => {
  it('projects each asset and the bytes the playbook keeps', async () => {
    const playbook = numberedHarness();
    await playbook.define('picture', imageSource);

    await ran(playbook, 'picture', { product: 'a teapot' }, 1);
    await ran(playbook, 'picture', { product: 'a kettle' }, 2);

    expect(await playbook.rowOf(assetIdOf(2))).toEqual({
      media_type: 'image/png',
      bytes: onePixelPng.byteLength,
      sha256: pngDigest,
      kind: 'image',
      model: 'gateway/openai/gpt-image-2',
      run: runIdOf(2),
      kept_at: harnessStartsAt,
      expires_at: harnessStartsAt + 30 * day,
      expired_at: null,
      live: true,
    });
    expect(await playbook.totals()).toEqual({ bytes: 2 * onePixelPng.byteLength, assets: 2 });
  });

  it('signs an address of fifteen minutes to the bytes where the runtime is given a signer and its own origin', async () => {
    const signing = contentAddressesUnder(Redacted.make(new Uint8Array(32).fill(3)), () => harnessStartsAt);
    const playbook = numberedHarness({ addresses: { signedContentAddress: signing.signedContentAddress, ownOrigin } });
    await playbook.define('picture', imageSource);
    const until = Math.floor(harnessStartsAt / 1000) + 900;

    expect(await ran(playbook, 'picture', { product: 'a teapot' })).toMatchObject({
      output: {
        output: {
          address: signing.signedContentAddress(ownOrigin(), alpha, pngDigest, until),
          address_until: new Date(until * 1000).toISOString(),
        },
      },
    });
  });
});

describe('the time a generation keeps its asset, and what it records of its key and its cost', () => {
  it('keeps an asset as long as the runtime keeps one where the document names no expiry, and records no cost the gateway does not say', async () => {
    const playbook = numberedHarness({
      answering: answeredByKind(''),
      ownKey: false,
      bounds: { ...generationBounds, keptMs: 7 * day },
    });
    await playbook.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2']));

    const outcome = await ran(playbook, 'picture', {});
    const facts = await playbook.factsOf(assetIdOf(1));
    const made = generationOfKept(facts);

    expect(recordIn(outcome)).toEqual({ model: 'gateway/openai/gpt-image-2', own_key: false, duration_ms: 0 });
    expect([made.cost_usd, made.own_key, keptDataOf(facts).expires_at]).toEqual([
      undefined,
      false,
      new Date(harnessStartsAt + 7 * day).toISOString(),
    ]);
  });

  it('keeps an asset 90 days where neither the document nor the runtime says otherwise, and waits as long as it is told', async () => {
    const playbook = generationHarness({ answerMs: 60_000 });
    await playbook.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2']));

    const outcome = await ran(playbook, 'picture', {});

    expect(keptDataOf(await playbook.factsOf(assetIdIn(outcome))).expires_at).toBe(
      new Date(harnessStartsAt + 90 * day).toISOString(),
    );
  });
});

describe('a run of a generation function that makes audio', () => {
  it('asks for speech in the voice the document names and the first format of the model, and keeps it as audio', async () => {
    const playbook = numberedHarness();
    await playbook.define('welcome', audioSource);

    const outcome = await ran(playbook, 'welcome', { shop: 'the corner shop' });

    expect(outcome).toMatchObject({ output: { output: { media_type: 'audio/mpeg', bytes: spokenBytes.byteLength } } });
    expect(playbook.gateway.asked().map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: '/v1/audio/speech',
        body: {
          model: 'openai/gpt-4o-mini-tts',
          input: 'Welcome to the corner shop. Today is 2026-11-01.',
          voice: 'coral',
          response_format: 'mp3',
        },
      },
    ]);
  });

  it('takes the first voice of the model where the document names none', async () => {
    const playbook = numberedHarness();
    await playbook.define('welcome', sourceWith(['produces: audio', 'model: gateway/openai/gpt-4o-mini-tts']));

    await ran(playbook, 'welcome', {});

    expect(playbook.gateway.asked()[0]?.body).toMatchObject({ voice: 'alloy', response_format: 'mp3' });
  });
});
