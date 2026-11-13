import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { joinedProviders, providersShippedRoots, readProviders, rendersOf } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { tracker } from '../testing/index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

describe('the shipped providers a message through which can be a card', () => {
  it('are the two Slack entries, each naming the render target slack', () => {
    expect(
      shipped.providers
        .filter(({ entry }) => entry.renders !== undefined)
        .map(({ entry }) => [entry.name, entry.renders]),
    ).toEqual([
      ['slack', 'slack'],
      ['slack-bot', 'slack'],
    ]);
  });

  it('answer by the name of the provider, and nothing for a provider that renders none or a server given by hand', () => {
    expect(['slack', 'slack-bot', 'zoom', 'unknown', null].map((provider) => rendersOf(shipped, provider))).toEqual([
      'slack',
      'slack',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('are taken from an entry of whoever runs the runtime too', () => {
    const own = decodedEntry({ ...tracker, renders: 'cards' });

    expect(rendersOf(joinedProviders(shipped, [own]), 'tracker')).toBe('cards');
  });
});
