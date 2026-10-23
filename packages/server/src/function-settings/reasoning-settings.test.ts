import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the reasoning function settings', () => {
  it('let the model calls of a run add up to 2,000,000 input tokens when nothing is set, or the setting is empty', () => {
    expect([readSettingsOf({}).reasoning, readSettingsOf({ REASONING_MAX_INPUT_TOKENS: '' }).reasoning]).toEqual([
      { mostInputTokens: 2_000_000 },
      { mostInputTokens: 2_000_000 },
    ]);
  });

  it('read the most input tokens of a run, from the least to the most a whole number of seven digits allows', () => {
    expect(
      ['10000', ' 500000 ', '9999999'].map(
        (tokens) => readSettingsOf({ REASONING_MAX_INPUT_TOKENS: tokens }).reasoning.mostInputTokens,
      ),
    ).toEqual([10_000, 500_000, 9_999_999]);
  });

  it('stop the server from starting when the most input tokens are out of range or not a whole number', () => {
    const refused =
      'InvalidSettingsError: The reasoning function settings are invalid. REASONING_MAX_INPUT_TOKENS: Expected a whole number from 10000 to 9999999, such as 2000000';

    expect(
      ['9999', '10000000', 'many', '1e6'].map((tokens) => String(errorFrom({ REASONING_MAX_INPUT_TOKENS: tokens }))),
    ).toEqual([refused, refused, refused, refused]);
  });
});
