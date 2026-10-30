import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ExtensionManifestSchema } from './extension-manifest.ts';

const decoded = Schema.decodeUnknownOption(ExtensionManifestSchema);

describe('the manifest of an extension', () => {
  it('names the package and its version, and the point each implementation fills with the contract it was built against', () => {
    const implementation = { answers: 'example' };
    const manifest = {
      name: '@example/extension',
      version: '2.0.0',
      provides: [{ point: 'example/point', contract: 3, implementation }],
    };

    expect(Option.getOrThrow(decoded(manifest)).provides).toEqual([
      { point: 'example/point', contract: 3, implementation },
    ]);
  });

  it('is refused without the points it provides, or with a contract that is not a whole number', () => {
    expect([
      decoded({ name: '@example/extension', version: '2.0.0' }),
      decoded({ name: '@example/extension', version: '2.0.0', provides: [{ point: 'p', contract: 1.5 }] }),
    ]).toEqual([Option.none(), Option.none()]);
  });
});
