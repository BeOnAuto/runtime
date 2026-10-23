import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { freshInstances } from './fresh-instances.ts';

describe('the fresh source of instances', () => {
  it('makes a fresh instance for every unit, from the one module it compiled, even after a unit gave one back', async () => {
    const source = freshInstances(shippedFilesOnDisk);
    const [first, second] = await Promise.all([source(unitMemoryBytes), source(unitMemoryBytes)]);
    first.release(true);
    const third = await source(unitMemoryBytes);

    expect(new Set([first.module, second.module, third.module]).size).toBe(3);
  });
});
