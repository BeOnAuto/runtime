import { readdirSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationShippedRoots, readGenerationCatalog } from '../index.ts';
import { fileNameOf, referenceLimitsOf, type CatalogEntry } from './catalog-entry.ts';
import { knownAudioFormats } from './media-types.ts';

const shipped = Result.getOrThrow(await readGenerationCatalog(shippedFilesOnDisk(generationShippedRoots())));

function unknownFormatsOf(entry: CatalogEntry): readonly string[] {
  return entry.kind === 'audio' ? entry.limits.formats.filter((format) => !knownAudioFormats.includes(format)) : [];
}

const aName: unknown = expect.stringMatching(/\S/u);

const files = readdirSync(new URL('.', import.meta.url)).filter((file) => file.endsWith('.yaml'));

const shippedModels = [
  'audio openai/gpt-4o-mini-tts',
  'audio openai/tts-1',
  'audio openai/tts-1-hd',
  'audio vertex_ai/gemini-3.8-flash-lite-tts',
  'audio vertex_ai/gemini-3.8-flash-tts',
  'image openai/gpt-image-2',
  'image openai/gpt-image-2.6-flare',
  'image openai/gpt-image-2.6-sunburst',
  'image vertex_ai/gemini-3-pro-image',
  'image vertex_ai/gemini-nano-banana-2.1',
  'image xai/grok-imagine-image-2.0',
  'video vertex_ai/veo-3.1-fast-generate-001',
  'video vertex_ai/veo-3.1-generate-001',
  'video vertex_ai/veo-3.1-lite-generate-001',
];

describe('the catalogue of generation models the runtime ships', () => {
  it('reads every entry of the folder, each file named for its model, in the order of their models', () => {
    expect(shipped.entries.map(({ model }) => model)).toEqual(shipped.entries.map(({ model }) => model).toSorted());
    expect(shipped.entries.map(({ model }) => fileNameOf(model)).toSorted()).toEqual(files.toSorted());
  });

  it('names the image and audio models of the gateway the runtime calls', () => {
    expect(shipped.entries.map(({ model, kind }) => `${kind} ${model}`).toSorted()).toEqual(shippedModels);
  });

  it('gives every audio model formats the runtime keeps and a voice, and every model that takes references their media types', () => {
    expect(shipped.entries.flatMap((entry) => unknownFormatsOf(entry))).toEqual([]);
    expect(
      shipped.entries
        .filter((entry) => referenceLimitsOf(entry) !== undefined)
        .map(({ model, media_types: mediaTypes }) => [model, mediaTypes]),
    ).toEqual([
      ['openai/gpt-image-2', ['image/png', 'image/jpeg', 'image/webp']],
      ['openai/gpt-image-2.6-flare', ['image/png', 'image/jpeg', 'image/webp']],
      ['openai/gpt-image-2.6-sunburst', ['image/png', 'image/jpeg', 'image/webp']],
      ['vertex_ai/gemini-3-pro-image', ['image/png', 'image/jpeg', 'image/webp']],
      ['vertex_ai/gemini-nano-banana-2.1', ['image/png', 'image/jpeg', 'image/webp']],
      ['vertex_ai/veo-3.1-fast-generate-001', ['image/png', 'image/jpeg']],
      ['vertex_ai/veo-3.1-generate-001', ['image/png', 'image/jpeg']],
      ['xai/grok-imagine-image-2.0', ['image/png', 'image/jpeg', 'image/webp']],
    ]);
  });

  it('names every quality OpenAI gives gpt-image-2.6-flare, low first, so a run whose document names none asks for low', () => {
    expect(shipped.entryOf('openai/gpt-image-2.6-flare')).toMatchObject({
      kind: 'image',
      limits: { qualities: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] },
    });
  });

  it('gives every model the name its provider gives it', () => {
    expect(shipped.entries.map(({ name }) => name)).toEqual(shipped.entries.map(() => aName));
  });

  it('finds each model by its name, and none it does not name', () => {
    expect([shipped.entryOf('openai/tts-1')?.kind, shipped.entryOf('openai/gpt-5')]).toEqual(['audio', undefined]);
  });
});

describe('the speech models OpenAI retires', () => {
  it('retire on the day OpenAI shuts them down, each for a Gemini speech model', () => {
    expect(
      shipped.entries.filter(({ retired }) => retired !== undefined).map(({ model, retired }) => [model, retired]),
    ).toEqual([
      ['openai/gpt-4o-mini-tts', { on: '2027-01-06', replacement: 'vertex_ai/gemini-3.8-flash-tts' }],
      ['openai/tts-1', { on: '2027-01-06', replacement: 'vertex_ai/gemini-3.8-flash-lite-tts' }],
      ['openai/tts-1-hd', { on: '2027-01-06', replacement: 'vertex_ai/gemini-3.8-flash-tts' }],
    ]);
  });
});
