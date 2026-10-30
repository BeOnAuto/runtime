import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots } from './api-roots.ts';

describe('the roots of the files the API ships', () => {
  it('load where import.meta.url names no file, and are named only when the files are read', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./api-roots.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('apiShippedRoots');
    expect(apiShippedRoots()).toEqual({
      '@on.auto/api': new URL('../../', import.meta.url),
      '@on.auto/runtime': new URL('../../../../', import.meta.url),
    });
  });
});
