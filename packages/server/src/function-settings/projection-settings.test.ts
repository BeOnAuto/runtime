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

describe('the projection settings', () => {
  it('build the views of 4 pages of a playbook at once and fold 4 playbooks at once when nothing is set', () => {
    expect(readSettingsOf({}).projection).toEqual({ pageRebuildsAtOnce: 4, playbooksAtOnce: 4 });
  });

  it('read each of the two', () => {
    expect(readSettingsOf({ PAGE_MAX_REBUILDS: ' 2 ', PROJECTION_PLAYBOOKS_AT_ONCE: '8' }).projection).toEqual({
      pageRebuildsAtOnce: 2,
      playbooksAtOnce: 8,
    });
  });

  it('stop the server from starting when one is out of its range or not a whole number, naming each', () => {
    expect(String(errorFrom({ PAGE_MAX_REBUILDS: '65', PROJECTION_PLAYBOOKS_AT_ONCE: 'many' }))).toBe(
      'InvalidSettingsError: The projection settings are invalid. PAGE_MAX_REBUILDS: Expected a whole number from 1 to 64, such as 4; PROJECTION_PLAYBOOKS_AT_ONCE: Expected a whole number from 1 to 64, such as 4',
    );
  });
});
