import { describe, expect, it } from 'vitest';

import { keysOfOne, streamsOfTheRun } from './recorded-keys.ts';

describe('the keys of a read', () => {
  it("name one key with its org, the key's second segment, whether it names a playbook or a definition, and no org for a key of fewer segments", () => {
    expect([
      keysOfOne('playbook/acme/alpha/'),
      keysOfOne('definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/'),
      keysOfOne('alpha'),
    ]).toEqual([
      { org: 'acme', keys: ['playbook/acme/alpha/'] },
      { org: 'acme', keys: ['definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/'] },
      { org: '', keys: ['alpha'] },
    ]);
  });

  it("name a run's two streams under each key, in the order of the keys", () => {
    expect(streamsOfTheRun(['playbook/acme/alpha/', 'definition/acme/d1/'], 'r1')).toEqual([
      'playbook/acme/alpha/runs/r1',
      'playbook/acme/alpha/run-logs/r1',
      'definition/acme/d1/runs/r1',
      'definition/acme/d1/run-logs/r1',
    ]);
  });
});
