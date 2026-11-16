import type { Environment } from '@on.auto/config';
import type { GenerationBounds } from '@on.auto/generation';
import { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

const mebibyte = 1_048_576;

const minute = 60_000;

const day = 86_400_000;

const generationCounts = {
  image: { setting: 'GENERATION_MAX_IMAGE_MIB', least: 1, most: 1024, example: 20 },
  audio: { setting: 'GENERATION_MAX_AUDIO_MIB', least: 1, most: 1024, example: 50 },
  video: { setting: 'GENERATION_MAX_VIDEO_MIB', least: 1, most: 4096, example: 200 },
  wait: { setting: 'GENERATION_WAIT_MINUTES', least: 1, most: 60, example: 10 },
} satisfies Readonly<Record<string, CountBounds>>;

const assetCounts = {
  file: { setting: 'ASSET_MAX_FILE_MIB', least: 1, most: 4096, example: 100 },
  quota: { setting: 'ASSET_STORAGE_QUOTA_MIB', least: 1, most: 1_048_576, example: 2048 },
  days: { setting: 'ASSET_RETENTION_DAYS', least: 1, most: 3650, example: 90 },
} satisfies Readonly<Record<string, CountBounds>>;

export type GenerationSettings = GenerationBounds;

export const generationVariables: readonly string[] = [
  ...Object.values(generationCounts),
  ...Object.values(assetCounts),
].map(({ setting }: CountBounds) => setting);

export function readGenerationSettings(
  environment: Environment,
): Effect.Effect<GenerationSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const { image, audio, video, wait } = yield* countsIn(environment, {
      settings: 'generation function settings',
      bounds: generationCounts,
    });
    const { file, quota, days } = yield* countsIn(environment, { settings: 'asset settings', bounds: assetCounts });
    return {
      mostBytes: { image: image * mebibyte, audio: audio * mebibyte, video: video * mebibyte },
      mostFileBytes: file * mebibyte,
      mostPlaybookBytes: quota * mebibyte,
      keptMs: days * day,
      waitMs: wait * minute,
    };
  });
}
