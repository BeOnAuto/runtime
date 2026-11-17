import type { Capability } from '@on.auto/definitions';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationShippedRoots, guideVariablesOf, readGenerationCatalog } from '../index.ts';
import { assetIdIn, assetIdOf, day, keptDataOf, numberedHarness, ran, refusalOf } from '../run-testing/run-outcomes.ts';
import { fakeGatewaySettings, harnessStartsAt, onePixelPng, sourceWith } from '../testing/index.ts';
import { generationBounds, type GenerationBounds } from './generation-ports.ts';

const shipped = Result.getOrThrow(await readGenerationCatalog(shippedFilesOnDisk(generationShippedRoots())));

const mebibyte = 1_048_576;

const asThePagesWriteThem = {
  'generation.most_image': '20 MiB',
  'generation.most_audio': '50 MiB',
  'generation.most_video': '200 MiB',
  'generation.most_kept': '2,048 MiB',
  'generation.kept': '90 days',
  'generation.bounds_changed_by': 'can be changed only by whoever runs the server',
  'generation.example_image_model': 'gateway/openai/gpt-image-2',
  'generation.example_audio_model': 'gateway/vertex_ai/gemini-3.8-flash-tts',
  'generation.example_video_model': 'gateway/vertex_ai/veo-3.1-fast-generate-001',
};

const ofACloud: GenerationBounds = {
  ...generationBounds,
  mostBytes: { image: 8 * mebibyte, audio: 32 * mebibyte, video: 32 * mebibyte },
  mostPlaybookBytes: 1_024_000 * mebibyte,
  keptMs: day,
};

type Written = 'value' | 'default';

function wordsOf(capability: Capability, written: Written): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(capability.guide.variables ?? {}).map(
      ([name, words]: readonly [string, Readonly<Record<Written, string>>]) => [name, words[written]],
    ),
  );
}

function said(capability: Capability, name: string): string {
  return String(capability.guide.variables?.[name]?.value);
}

describe('the values the guide of generation functions names', () => {
  it('are, on a server given no bounds of its own and a gateway of the name the pages use, the words the pages write', () => {
    const { capability } = numberedHarness();

    expect(wordsOf(capability, 'value')).toEqual(asThePagesWriteThem);
    expect(wordsOf(capability, 'default')).toEqual(asThePagesWriteThem);
  });

  it('are the bounds and the first gateway the capability is given, while the defaults stay the words the pages write', () => {
    const images = { ...fakeGatewaySettings, name: 'images' };
    const { capability } = numberedHarness({
      bounds: ofACloud,
      gateways: [images, { ...fakeGatewaySettings, name: 'voices' }],
    });

    expect(wordsOf(capability, 'value')).toEqual({
      'generation.most_image': '8 MiB',
      'generation.most_audio': '32 MiB',
      'generation.most_video': '32 MiB',
      'generation.most_kept': '1,024,000 MiB',
      'generation.kept': '1 day',
      'generation.bounds_changed_by': 'can be changed only by whoever runs the server',
      'generation.example_image_model': 'images/openai/gpt-image-2',
      'generation.example_audio_model': 'images/vertex_ai/gemini-3.8-flash-tts',
      'generation.example_video_model': 'images/vertex_ai/veo-3.1-fast-generate-001',
    });
    expect(wordsOf(capability, 'default')).toEqual(asThePagesWriteThem);
    expect(guideVariablesOf(ofACloud, ['images'])).toEqual(capability.guide.variables);
  });
});

describe('the models the examples of the guide of generation functions name', () => {
  it('leave their gateway to fill in where the server is given none, which a save refuses as it is', async () => {
    const { capability } = numberedHarness({ gateways: [] });
    const copied = said(capability, 'generation.example_image_model');

    const refused = await Effect.runPromise(
      Effect.flip(capability.prepare(sourceWith(['produces: image', `model: ${copied}`]))),
    );

    expect(copied).toBe('<gateway>/openai/gpt-image-2');
    expect(said(capability, 'generation.example_audio_model')).toBe('<gateway>/vertex_ai/gemini-3.8-flash-tts');
    expect(said(capability, 'generation.example_video_model')).toBe('<gateway>/vertex_ai/veo-3.1-fast-generate-001');
    expect(refused.issues).toEqual([
      { pointer: '', detail: 'Line 3, /model: A model is written gateway/model, such as gateway/openai/gpt-image-2' },
    ]);
  });

  it('are models of the catalogue the runtime ships, which a function saves', async () => {
    const playbook = numberedHarness({ catalog: shipped });

    const picture = await playbook.define(
      'picture',
      sourceWith(['produces: image', `model: ${said(playbook.capability, 'generation.example_image_model')}`]),
    );
    const welcome = await playbook.define(
      'welcome',
      sourceWith(['produces: audio', `model: ${said(playbook.capability, 'generation.example_audio_model')}`]),
    );
    const film = await playbook.define(
      'film',
      sourceWith(['produces: video', `model: ${said(playbook.capability, 'generation.example_video_model')}`]),
    );

    expect([picture.status, welcome.status, film.status]).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });
});

describe('a run of the capability, against the values its guide names', () => {
  it('is refused for an image or audio larger than the guide says, after asking the gateway the guide names', async () => {
    const playbook = numberedHarness({
      bounds: { ...generationBounds, mostBytes: { ...generationBounds.mostBytes, image: 16, audio: 4 } },
      gateways: [{ ...fakeGatewaySettings, name: 'images' }],
      catalog: shipped,
    });
    await playbook.define(
      'picture',
      sourceWith(['produces: image', `model: ${said(playbook.capability, 'generation.example_image_model')}`]),
    );
    await playbook.define(
      'welcome',
      sourceWith(['produces: audio', `model: ${said(playbook.capability, 'generation.example_audio_model')}`]),
    );

    const refused = [await ran(playbook, 'picture', {}, 1), await ran(playbook, 'welcome', {}, 2)].map(
      (outcome) => refusalOf(outcome).detail,
    );

    expect(refused).toEqual([
      `The image the model made is larger than the ${said(playbook.capability, 'generation.most_image')} this runtime keeps of one image`,
      `The audio the model made is larger than the ${said(playbook.capability, 'generation.most_audio')} this runtime keeps of one audio`,
    ]);
    expect(playbook.gateway.asked()).toHaveLength(2);
  });

  it('keeps an asset for as long as the guide says, and refuses a run once the playbook keeps the quota it says', async () => {
    const playbook = numberedHarness({
      bounds: { ...generationBounds, mostPlaybookBytes: onePixelPng.byteLength, keptMs: 2 * day },
    });
    await playbook.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2']));

    const kept = await ran(playbook, 'picture', {}, 1);
    const full = await ran(playbook, 'picture', {}, 2);
    const keptFor =
      (Date.parse(keptDataOf(await playbook.factsOf(assetIdIn(kept))).expires_at) - harnessStartsAt) / day;

    expect(assetIdIn(kept)).toBe(assetIdOf(1));
    expect(`${String(keptFor)} days`).toBe(said(playbook.capability, 'generation.kept'));
    expect(refusalOf(full).detail).toBe(
      `The playbook keeps ${said(playbook.capability, 'generation.most_kept')} of assets, and may keep ${said(playbook.capability, 'generation.most_kept')}; an asset makes room as it expires`,
    );
  });
});
