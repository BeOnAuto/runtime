import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const ways = shipped.providers.flatMap(({ entry }) => entry.credentials);

describe('the ways of the shipped providers', () => {
  it('connect through no gateway, so no connection made from a shipped entry is made through one', () => {
    expect(ways.filter(({ gateway }) => gateway !== undefined)).toEqual([]);
  });

  it('say of none that it acts as the app, so each acts as the person who connects', () => {
    expect(ways.filter(({ permissions }) => permissions !== undefined)).toEqual([]);
  });
});
