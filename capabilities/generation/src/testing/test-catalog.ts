import { Result } from 'effect';

import type { CatalogEntry } from '../catalog/catalog-entry.ts';
import { catalogOf, type GenerationCatalog } from '../catalog/generation-catalog.ts';

const mebibyte = 1_048_576;

export const shortFilm: CatalogEntry = {
  model: 'example/short-film',
  kind: 'video',
  media_types: [],
  limits: { sizes: ['720x1280'], seconds: { least: 4, most: 12 }, prompt_characters: 400 },
};

export const testEntries: readonly CatalogEntry[] = [
  {
    model: 'openai/gpt-image-2',
    kind: 'image',
    media_types: ['image/png', 'image/jpeg', 'image/webp'],
    limits: {
      sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      qualities: ['auto', 'low', 'medium', 'high'],
      prompt_characters: 400,
      references: { most: 2, bytes: mebibyte },
    },
  },
  {
    model: 'example/square-image',
    kind: 'image',
    media_types: [],
    limits: { aspects: ['1:1', '16:9'], prompt_characters: 400 },
  },
  {
    model: 'openai/gpt-4o-mini-tts',
    kind: 'audio',
    media_types: [],
    limits: { voices: ['alloy', 'coral'], formats: ['mp3', 'wav'], prompt_characters: 400 },
  },
  {
    model: 'example/long-sound',
    kind: 'audio',
    media_types: [],
    limits: { voices: ['wind'], formats: ['flac'], seconds: { least: 1, most: 30 }, prompt_characters: 400 },
  },
  shortFilm,
  {
    model: 'example/old-image',
    kind: 'image',
    media_types: [],
    limits: { sizes: ['1024x1024'], prompt_characters: 400 },
    retired: { on: '2026-06-30', replacement: 'openai/gpt-image-2' },
  },
];

export const testCatalog: GenerationCatalog = Result.getOrThrow(catalogOf(testEntries));
