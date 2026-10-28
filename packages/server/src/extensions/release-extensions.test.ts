import { modelRuntimePoint } from '@on.auto/prediction';
import { manifest } from '@on.auto/prediction-onnx';
import { describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { installedPackages, listedExtensions, loadedExtensions } from './extension-loading.ts';
import { integrityOf } from './package-integrity.ts';
import { releaseExtensions } from './release-extensions.ts';

describe('the extensions of the release', () => {
  it('are loaded as the settings list one would be, last, marked as the release’s, filling prediction/model-runtime', async () => {
    const loaded = await loadedExtensions(listedExtensions([], releaseExtensions), [modelRuntimePoint]);

    expect(loaded.extensions).toEqual([
      {
        package: manifest.name,
        provenance: 'release',
        name: manifest.name,
        version: release.version,
        provides: [{ point: 'prediction/model-runtime', contract: 1 }],
      },
    ]);
    expect(loaded.provided(modelRuntimePoint).map(({ formats }) => formats)).toEqual([['onnx']]);
  });

  it('are found where they are installed, so their integrity can be pinned as any package’s', async () => {
    const [onnx] = releaseExtensions;
    const directory = installedPackages.directoryOf(String(onnx?.package));
    const integrity = await integrityOf(directory);

    const pinned = await loadedExtensions(
      listedExtensions([{ package: String(onnx?.package), integrity }], releaseExtensions),
      [modelRuntimePoint],
    );

    expect(directory).toMatch(/\/packages\/prediction-onnx$/u);
    expect(pinned.extensions.map(({ provenance }) => provenance)).toEqual(['configured']);
  });
});
