import type { CallerIdentity } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { adding, notes } from '../testing/additions.ts';
import { ada, harness } from '../testing/harness.ts';

const acmeBuilder: CallerIdentity = { ...ada, id: 'acme-builder', name: 'acme-builder' };

const localDeveloper: CallerIdentity = { ...ada, id: 'local', name: 'ada' };

describe('who adds a connection', () => {
  it('is a person on a runtime that signs people in, and never a key', async () => {
    const h = harness({ access: 'people' });

    expect(await adding(h, notes, acmeBuilder)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'A connection is added by a person, through an agent signed in as them, and a key cannot add one',
    });
    expect(await adding(h, notes)).toMatchObject({
      status: 'succeeded',
      output: { added_by: { id: 'person:ada', name: 'Ada Lovelace' } },
    });
  });

  it('is nobody on a runtime of keys alone, which signs in no person to approve one', async () => {
    const h = harness({ access: 'keys' });

    expect(await adding(h, notes, acmeBuilder)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail:
        'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
    });
    expect(await h.facts()).toEqual([]);
  });

  it('is the local developer in local mode', async () => {
    const h = harness({ access: 'local' });

    expect(await adding(h, notes, localDeveloper)).toMatchObject({
      status: 'succeeded',
      output: { added_by: { id: 'local', name: 'ada' } },
    });
  });
});
