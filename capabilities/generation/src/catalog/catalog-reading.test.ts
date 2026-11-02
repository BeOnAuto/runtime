import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { readGenerationCatalog, shippedCatalog } from '../index.ts';
import { testEntries } from '../testing/index.ts';
import type { CatalogEntry } from './catalog-entry.ts';
import { catalogOf } from './generation-catalog.ts';

const folder = { package: 'test', path: 'models' };

async function refusalOf(files: Readonly<Record<string, string>>): Promise<string> {
  const held = Object.fromEntries(
    Object.entries(files).map(([name, text]: readonly [string, string]) => [`models/${name}`, text]),
  );
  const read = await readGenerationCatalog(shippedFilesInMemory({ test: held }), folder);
  return Result.isSuccess(read) ? 'read' : read.failure.message;
}

function refusals(entries: readonly CatalogEntry[]) {
  const read = catalogOf(entries);
  return Result.isSuccess(read) ? [] : read.failure;
}

const tts = [
  'model: example/voice',
  'kind: audio',
  'media_types: []',
  'limits: { voices: [alloy], formats: [mp3], prompt_characters: 400 }',
].join('\n');

function entryNamed(model: string): CatalogEntry {
  const found = testEntries.find((entry) => entry.model === model);
  if (found === undefined) {
    throw new Error(`The test catalogue names no ${model}`);
  }
  return found;
}

const said = 'The catalogue of generation models is invalid: ';

describe('the reading of a catalogue of generation models', () => {
  it('reads a folder of entries, and passes over its other files', async () => {
    expect(await refusalOf({ 'example-voice.yaml': tts, 'README.md': '# Models' })).toBe('read');
    expect(shippedCatalog).toEqual({ package: '@on.auto/generation', path: 'src/catalog' });
  });

  it('refuses an entry that is no YAML mapping, names no kind, or names one it is not written for', async () => {
    expect(await refusalOf({ 'a.yaml': '- one\n- two' })).toBe(
      `${said}test/models/a.yaml:1:1: A model's entry is a mapping of its fields`,
    );
    expect(await refusalOf({ 'a.yaml': 'model: a\nkind: document' })).toBe(
      `${said}test/models/a.yaml:2:7 kind: Expected "image" | "audio" | "video"`,
    );
    expect(await refusalOf({ 'example-voice.yaml': tts.replace('voices: [alloy], ', '') })).toBe(
      `${said}test/models/example-voice.yaml:4:9 limits.voices: Missing key`,
    );
  });

  it('refuses an entry whose file is not named for its model, and a model named twice', async () => {
    expect(await refusalOf({ 'voice.yaml': tts })).toBe(
      `${said}test/models/voice.yaml:1:8 model: Expected the model the file is named for, as in example-voice.yaml`,
    );
  });

  it('refuses limits that contradict each other, formats it keeps no media type for and references without media types', async () => {
    const seconds = tts.replace('prompt_characters: 400', 'prompt_characters: 400, seconds: { least: 9, most: 3 }');
    expect(await refusalOf({ 'example-voice.yaml': seconds })).toBe(
      `${said}test/models/example-voice.yaml: limits.seconds: the least, 9, is more than the most, 3`,
    );
    expect(await refusalOf({ 'example-voice.yaml': tts.replace('[mp3]', '[mp3, pcm]') })).toBe(
      `${said}test/models/example-voice.yaml: limits.formats: pcm is no format the runtime keeps, which are mp3, wav, opus, aac, or flac`,
    );
  });
});

describe('a catalogue of entries', () => {
  it('holds the entries it is given and finds each by its model', () => {
    const catalog = Result.getOrThrow(catalogOf(testEntries));

    expect([catalog.entries.length, catalog.entryOf('example/old-image')?.retired?.on]).toEqual([6, '2026-06-30']);
  });

  it('refuses a model named twice, references and media types that disagree, and a replacement that is none', () => {
    const image = entryNamed('openai/gpt-image-1');
    const square = entryNamed('example/square-image');
    const video = entryNamed('openai/sora-2');
    const old = entryNamed('example/old-image');

    expect(refusals([square, square])).toEqual([
      { model: 'example/square-image', detail: 'example/square-image has more than one entry' },
    ]);
    expect(
      refusals([
        { ...image, media_types: [] },
        { ...square, media_types: ['image/png'] },
      ]),
    ).toEqual([
      {
        model: 'openai/gpt-image-1',
        detail: 'media_types: a model that takes references names the media types it takes',
      },
      { model: 'example/square-image', detail: 'media_types: a model that takes no references names no media types' },
    ]);
    expect(refusals([old])).toEqual([
      {
        model: 'example/old-image',
        detail: 'retired.replacement: openai/gpt-image-1 is no other model of the catalogue',
      },
    ]);
    expect(refusals([{ ...old, retired: { on: '2026-06-30', replacement: 'example/old-image' } }])).toEqual([
      {
        model: 'example/old-image',
        detail: 'retired.replacement: example/old-image is no other model of the catalogue',
      },
    ]);
    expect(
      refusals([old, { ...image, retired: { on: '2026-06-30', replacement: 'example/square-image' } }, square]),
    ).toEqual([{ model: 'example/old-image', detail: 'retired.replacement: openai/gpt-image-1 is retired too' }]);
    expect(refusals([{ ...old, retired: { on: '2026-06-30', replacement: 'openai/sora-2' } }, video])).toEqual([
      { model: 'example/old-image', detail: 'retired.replacement: openai/sora-2 produces video, not image' },
    ]);
  });
});
