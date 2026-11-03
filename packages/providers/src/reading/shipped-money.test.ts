import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

describe('the shipped providers whose tools handle money', () => {
  it('are Stripe alone, whose tools refund and pay out', () => {
    expect(
      shipped.providers.filter(({ entry }) => entry.handles_money === true).map(({ entry }) => entry.name),
    ).toEqual(['stripe']);
  });
});
