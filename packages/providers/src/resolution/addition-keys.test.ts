import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { tracker } from '../testing/fixture-providers.ts';

const keyPage = 'https://app.tracker.example.com/settings/keys';

const [byKey] = tracker.credentials;

describe('the credential of an addition by a key', () => {
  it('carries how its key is made and what it looks like from the way, and not the description of the way', () => {
    const formatted = decodedEntry({
      ...tracker,
      credentials: [{ ...byKey, example: 'trk_…', pattern: '^trk_\\w+$' }],
    });

    expect(Result.getOrThrow(additionOfProvider(formatted, { placeholders: { site: 'acme' } })).credential).toEqual({
      kind: 'secret',
      in: 'header',
      name: 'Authorization',
      scheme: 'Bearer',
      instructions: `Make a key at [app.tracker.example.com](${keyPage}) under **Settings**, **Keys**, with read access.`,
      key_page: keyPage,
      example: 'trk_…',
      pattern: '^trk_\\w+$',
    });
  });
});
