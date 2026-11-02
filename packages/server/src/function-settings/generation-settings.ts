import type { Environment } from '@on.auto/config';
import type { GenerationBounds } from '@on.auto/generation';
import { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

const mebibyte = 1_048_576;

const day = 86_400_000;

const bounds = {
  image: { setting: 'GENERATION_MAX_IMAGE_MIB', least: 1, most: 1024, example: 20 },
  audio: { setting: 'GENERATION_MAX_AUDIO_MIB', least: 1, most: 1024, example: 50 },
  video: { setting: 'GENERATION_MAX_VIDEO_MIB', least: 1, most: 4096, example: 200 },
  playbook: { setting: 'GENERATION_MAX_PLAYBOOK_MIB', least: 1, most: 1_048_576, example: 2048 },
  days: { setting: 'GENERATION_RETENTION_DAYS', least: 1, most: 3650, example: 90 },
} satisfies Readonly<Record<string, CountBounds>>;

export type GenerationSettings = GenerationBounds;

export const generationVariables: readonly string[] = Object.values(bounds).map(({ setting }: CountBounds) => setting);

export function readGenerationSettings(
  environment: Environment,
): Effect.Effect<GenerationSettings, InvalidSettingsError> {
  return Effect.map(
    countsIn(environment, { settings: 'generation function settings', bounds }),
    ({ image, audio, video, playbook, days }) => ({
      mostBytes: { image: image * mebibyte, audio: audio * mebibyte, video: video * mebibyte },
      mostPlaybookBytes: playbook * mebibyte,
      keptMs: days * day,
    }),
  );
}
