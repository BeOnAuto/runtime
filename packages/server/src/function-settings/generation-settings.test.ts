import { generationBounds } from '@on.auto/generation';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { generationVariables } from './generation-settings.ts';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

const mebibyte = 1_048_576;

describe('the generation function settings and the asset settings', () => {
  it('keep the defaults of the capability, 20 MiB of an image, 50 of audio, 200 of a video, 100 MiB of a file, a storage quota of 2 GiB a playbook, no expiry of an asset, and ten minutes of waiting for a video', () => {
    expect(readSettingsOf({}).generation).toEqual(generationBounds);
  });

  it('read what the operator sets, in MiB, in days and in minutes', () => {
    expect(
      readSettingsOf({
        GENERATION_MAX_IMAGE_MIB: '5',
        GENERATION_MAX_AUDIO_MIB: '6',
        GENERATION_MAX_VIDEO_MIB: '7',
        GENERATION_WAIT_MINUTES: '45',
        ASSET_MAX_FILE_MIB: '4096',
        ASSET_STORAGE_QUOTA_MIB: '1048576',
        ASSET_RETENTION_DAYS: '30',
      }).generation,
    ).toEqual({
      mostBytes: { image: 5 * mebibyte, audio: 6 * mebibyte, video: 7 * mebibyte },
      mostFileBytes: 4096 * mebibyte,
      mostPlaybookBytes: 1_048_576 * mebibyte,
      keptMs: 30 * 86_400_000,
      waitMs: 45 * 60_000,
    });
  });
});

describe('the variables of the generation function settings and the asset settings', () => {
  it('are the variables the runtime reads of them, the generation function settings and then the asset settings', () => {
    expect(generationVariables).toEqual([
      'GENERATION_MAX_IMAGE_MIB',
      'GENERATION_MAX_AUDIO_MIB',
      'GENERATION_MAX_VIDEO_MIB',
      'GENERATION_WAIT_MINUTES',
      'ASSET_MAX_FILE_MIB',
      'ASSET_STORAGE_QUOTA_MIB',
      'ASSET_RETENTION_DAYS',
    ]);
  });
});

describe('a generation function setting or an asset setting out of its range', () => {
  it.each([
    ['generation function settings', 'GENERATION_MAX_IMAGE_MIB', '0', 'from 1 to 1024, such as 20'],
    ['generation function settings', 'GENERATION_WAIT_MINUTES', '61', 'from 1 to 60, such as 10'],
    ['asset settings', 'ASSET_MAX_FILE_MIB', '4097', 'from 1 to 4096, such as 100'],
    ['asset settings', 'ASSET_MAX_FILE_MIB', '0', 'from 1 to 4096, such as 100'],
    ['asset settings', 'ASSET_STORAGE_QUOTA_MIB', 'lots', 'from 1 to 1048576, such as 2048'],
    ['asset settings', 'ASSET_RETENTION_DAYS', '3651', 'from 1 to 3650, such as 90'],
  ])(
    'stop the server from starting, naming the setting and never its value: the %s, at %s %s',
    (group, setting, value, expected) => {
      expect(errorFrom({ [setting]: value })).toBe(
        `InvalidSettingsError: The ${group} are invalid. ${setting}: Expected a whole number ${expected}`,
      );
    },
  );
});
