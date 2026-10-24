import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

describe('the program pool', () => {
  it('loads where import.meta.url names no file, reading the module of a worker only as it makes a job of it', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./program-pool.ts', import.meta.url));

    expect(Object.keys(loaded)).toEqual(['checkPermits', 'mostCheckStartMs', 'programPool']);
  });
});
