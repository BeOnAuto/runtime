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

const files = readdirSync(new URL('.', import.meta.url)).filter((file) => file.endsWith('.yaml'));

describe('the catalogue of generation models the runtime ships', () => {
  it('reads every entry of the folder, each file named for its model, in the order of their models', () => {
    expect(shipped.entries.map(({ model }) => model)).toEqual(shipped.entries.map(({ model }) => model).toSorted());
    expect(shipped.entries.map(({ model }) => fileNameOf(model)).toSorted()).toEqual(files.toSorted());
  });

  it('names the image and audio models of the gateway the runtime calls, none of them retired', () => {
    expect(shipped.entries.map(({ model, kind }) => `${kind} ${model}`).toSorted()).toEqual([
      'audio openai/gpt-4o-mini-tts',
      'audio openai/tts-1',
      'audio openai/tts-1-hd',
      'image openai/gpt-image-1-mini',
      'image openai/gpt-image-2',
    ]);
    expect(shipped.entries.filter(({ retired }) => retired !== undefined)).toEqual([]);
  });

  it('gives every audio model formats the runtime keeps and a voice, and every model that takes references their media types', () => {
    expect(shipped.entries.flatMap((entry) => unknownFormatsOf(entry))).toEqual([]);
    expect(
      shipped.entries
        .filter((entry) => referenceLimitsOf(entry) !== undefined)
        .map(({ model, media_types: mediaTypes }) => [model, mediaTypes]),
    ).toEqual([
      ['openai/gpt-image-1-mini', ['image/png', 'image/jpeg', 'image/webp']],
      ['openai/gpt-image-2', ['image/png', 'image/jpeg', 'image/webp']],
    ]);
  });

  it('finds each model by its name, and none it does not name', () => {
    expect([shipped.entryOf('openai/tts-1')?.kind, shipped.entryOf('openai/gpt-5')]).toEqual(['audio', undefined]);
  });
});
