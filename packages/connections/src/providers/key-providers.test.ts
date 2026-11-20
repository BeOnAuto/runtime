import { tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { waysListedOf } from '../testing/listed-ways.ts';

const [aKey] = tracker.credentials;
const step = { title: 'Make a token at Tracker', instructions: 'Select **New token**, then copy it.' };
const words = { key_page_title: 'Create your Tracker token', steps: { key_page: step, connected: step } };

describe('a provider whose way is a key, as the page lists it', () => {
  it('gives the words that open its key page and the words of its steps exactly where its entry gives them', async () => {
    const [declared] = await waysListedOf({ ...tracker, credentials: [{ ...aKey, ...words }] });
    const [undeclared] = await waysListedOf(tracker);

    expect(declared).toMatchObject({ kind: 'secret', ...words });
    expect(undeclared).toMatchObject({ kind: 'secret' });
    expect(undeclared).not.toHaveProperty('key_page_title');
    expect(undeclared).not.toHaveProperty('steps');
  });
});
