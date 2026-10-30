import { describe, expect, it } from 'vitest';

import { listedExtensions, loadedExtensions } from './extension-loading.ts';
import { releaseExtensions } from './release-extensions.ts';

describe('the extensions of the release', () => {
  it('are none, so a runtime loads the extensions its settings list and no other', async () => {
    const loaded = await loadedExtensions(listedExtensions([], releaseExtensions), []);

    expect([releaseExtensions, loaded.extensions]).toEqual([[], []]);
  });
});
