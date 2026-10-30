import { describe, expect, it } from 'vitest';

import { loadedExtensions } from './extension-loading.ts';

describe('an extension the runtime imports from the packages installed beside it', () => {
  it('is read from the folder of that package, and refused when the package is no extension', async () => {
    const other = `sha512-${'B'.repeat(86)}==`;

    await expect(
      loadedExtensions(
        [{ package: '@on.auto/config', integrity: other, provenance: 'configured', ofTheRelease: false }],
        [],
      ),
    ).rejects.toThrow(/^The extension @on\.auto\/config is refused: its installed files have the integrity sha512-/u);
    await expect(
      loadedExtensions([{ package: '@on.auto/config', provenance: 'configured', ofTheRelease: false }], []),
    ).rejects.toThrow(
      'The extension @on.auto/config is refused: it exports no manifest; an extension exports its manifest as manifest',
    );
  });
});
