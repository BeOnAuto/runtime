import { renderTargetNames } from '@on.auto/interaction';
import { providersShippedRoots, readProviders } from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

describe('the render targets the shipped providers name', () => {
  it('are each a render target of the interaction capability', () => {
    const named = shipped.providers.map(({ entry }) => entry.renders).filter((target) => target !== undefined);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((target) => !renderTargetNames.some((name) => name === target))).toEqual([]);
  });
});
