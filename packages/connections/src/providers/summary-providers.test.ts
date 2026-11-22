import { tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { providersListedOf } from '../testing/listed-ways.ts';

const summary = 'Lets your playbooks read and change the issues of a tracker.';

describe('the one sentence of a provider, as the page lists it', () => {
  it('is given where its entry gives one, beside its description', async () => {
    const [listed] = await providersListedOf({ ...tracker, summary });

    expect(listed).toMatchObject({ name: 'tracker', description: tracker.description, summary });
  });

  it('is left out where its entry gives none', async () => {
    const [listed] = await providersListedOf(tracker);

    expect(listed).not.toHaveProperty('summary');
  });
});
