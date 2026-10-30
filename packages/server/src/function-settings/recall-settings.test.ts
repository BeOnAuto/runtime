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

describe('the recall function settings', () => {
  it('keep at most 32 recall functions a playbook, build 4 views of a playbook at once and follow 4 playbooks at once when nothing is set', () => {
    expect(readSettingsOf({}).recall).toEqual({
      mostFunctions: 32,
      rebuildsAtOnce: 4,
      playbooksAtOnce: 4,
    });
  });

  it('read each of the three', () => {
    expect(
      readSettingsOf({
        RECALL_MAX_FUNCTIONS: ' 100 ',
        RECALL_MAX_REBUILDS: '2',
        RECALL_PLAYBOOKS_AT_ONCE: '8',
      }).recall,
    ).toEqual({ mostFunctions: 100, rebuildsAtOnce: 2, playbooksAtOnce: 8 });
  });

  it('stop the server from starting when one is out of its range or not a whole number, naming each', () => {
    expect(
      String(
        errorFrom({
          RECALL_MAX_FUNCTIONS: '0',
          RECALL_MAX_REBUILDS: '65',
          RECALL_PLAYBOOKS_AT_ONCE: 'many',
        }),
      ),
    ).toBe(
      'InvalidSettingsError: The recall function settings are invalid. RECALL_MAX_FUNCTIONS: Expected a whole number from 1 to 1000, such as 32; RECALL_MAX_REBUILDS: Expected a whole number from 1 to 64, such as 4; RECALL_PLAYBOOKS_AT_ONCE: Expected a whole number from 1 to 64, such as 4',
    );
  });
});
