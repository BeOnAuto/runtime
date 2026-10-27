import { describe, expect, it } from 'vitest';

import { assertOfflineRunIdentity } from '../index.ts';

describe('reportable offline run identity', () => {
  it('accepts bounded canonical playbook and run identities before funds are held', () => {
    expect(() => {
      assertOfflineRunIdentity({ playbookId: 'playbook-1:version_2.3', runId: 'r'.repeat(256) });
    }).not.toThrow();
  });

  it.each(['', 'a'.repeat(257), 'leading space', '/route', 'é'])('refuses an unreportable identifier %s', (value) => {
    expect(() => {
      assertOfflineRunIdentity({ playbookId: value, runId: 'run-1' });
    }).toThrow('bounded and canonical');
    expect(() => {
      assertOfflineRunIdentity({ playbookId: 'playbook-1', runId: value });
    }).toThrow('bounded and canonical');
  });
});
