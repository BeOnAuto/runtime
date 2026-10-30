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

describe('the prediction function settings', () => {
  it('keep 32 active prediction functions a playbook unless PREDICTION_MAX_FUNCTIONS says otherwise', () => {
    expect(
      [{}, { PREDICTION_MAX_FUNCTIONS: ' 1000 ' }].map(
        (environment: Readonly<Record<string, string>>) => readSettingsOf(environment).prediction,
      ),
    ).toEqual([{ mostFunctions: 32 }, { mostFunctions: 1000 }]);
  });

  it.each(['0', '1001', 'many'])('stop the server from starting at %s active functions', (most) => {
    expect(errorFrom({ PREDICTION_MAX_FUNCTIONS: most })).toBe(
      'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_MAX_FUNCTIONS: Expected a whole number from 1 to 1000, such as 32',
    );
  });
});
