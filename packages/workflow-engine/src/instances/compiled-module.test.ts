import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { sandboxShippedRoots } from './compiled-module.ts';

describe('the module of the sandbox', () => {
  it('loads where import.meta.url names no file, and names the root of the engine only when its files are read', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./compiled-module.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('sandboxShippedRoots');
    expect(sandboxShippedRoots()).toEqual({ '@on.auto/workflow-engine': new URL('../../', import.meta.url) });
  });
});
