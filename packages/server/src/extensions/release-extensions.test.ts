import { modelRuntimePoint } from '@on.auto/prediction';
import { manifest as onnx } from '@on.auto/prediction-onnx';
import { manifest as series } from '@on.auto/prediction-series';
import { describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { installedPackages, listedExtensions, loadedExtensions } from './extension-loading.ts';
import { integrityOf } from './package-integrity.ts';
import { releaseExtensions } from './release-extensions.ts';

interface Pinned {
  readonly package: string;
  readonly integrity: string;
  readonly directory: string;
}

describe('the extensions of the release', () => {
  it('are loaded as the settings list one would be, last, marked as the release’s, each filling prediction/model-runtime for a format of its own', async () => {
    const loaded = await loadedExtensions(listedExtensions([], releaseExtensions), [modelRuntimePoint]);

    expect(loaded.extensions).toEqual(
      [onnx, series].map(({ name }) => ({
        package: name,
        provenance: 'release',
        name,
        version: release.version,
        provides: [{ point: 'prediction/model-runtime', contract: 2 }],
      })),
    );
    expect(loaded.provided(modelRuntimePoint).map(({ name, formats }) => [name, formats])).toEqual([
      ['onnxruntime-node', ['onnx']],
      ['series', ['series']],
    ]);
  });

  it('are found where they are installed, so their integrity can be pinned as any package’s', async () => {
    const pinned = await Promise.all(
      releaseExtensions.map(async ({ package: name }): Promise<Pinned> => {
        const directory = installedPackages.directoryOf(name);
        return { package: name, integrity: await integrityOf(directory), directory };
      }),
    );

    const loaded = await loadedExtensions(
      listedExtensions(
        pinned.map((each: Pinned) => ({ package: each.package, integrity: each.integrity })),
        releaseExtensions,
      ),
      [modelRuntimePoint],
    );

    expect(pinned.map((each: Pinned) => each.directory)).toEqual([
      expect.stringMatching(/\/packages\/prediction-onnx$/u),
      expect.stringMatching(/\/packages\/prediction-series$/u),
    ]);
    expect(loaded.extensions.map(({ provenance }) => provenance)).toEqual(['configured', 'configured']);
  });
});
