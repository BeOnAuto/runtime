import { generationBounds } from '@on.auto/generation';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

const mebibyte = 1_048_576;

describe('the generation function settings', () => {
  it('keep the defaults of the capability, 20 MiB of an image, 50 of audio, 200 of a video, 2 GiB a playbook, for 90 days', () => {
    expect(readSettingsOf({}).generation).toEqual(generationBounds);
  });

  it('read what the operator sets, in MiB and in days', () => {
    expect(
      readSettingsOf({
        GENERATION_MAX_IMAGE_MIB: '5',
        GENERATION_MAX_AUDIO_MIB: '6',
        GENERATION_MAX_VIDEO_MIB: '7',
        GENERATION_MAX_PLAYBOOK_MIB: '100',
        GENERATION_RETENTION_DAYS: '30',
      }).generation,
    ).toEqual({
      mostBytes: { image: 5 * mebibyte, audio: 6 * mebibyte, video: 7 * mebibyte },
      mostPlaybookBytes: 100 * mebibyte,
      keptMs: 30 * 86_400_000,
    });
  });

  it.each([
    ['GENERATION_MAX_IMAGE_MIB', '0', 'from 1 to 1024, such as 20'],
    ['GENERATION_RETENTION_DAYS', '3651', 'from 1 to 3650, such as 90'],
    ['GENERATION_MAX_PLAYBOOK_MIB', 'lots', 'from 1 to 1048576, such as 2048'],
  ])('stop the server from starting at %s %s', (setting, value, expected) => {
    expect(errorFrom({ [setting]: value })).toBe(
      `InvalidSettingsError: The generation function settings are invalid. ${setting}: Expected a whole number ${expected}`,
    );
  });
});
