import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acceptedModelRuntimeContracts, modelRuntimeContract } from '../contract/model-runtime-point.ts';
import type { ModelRuntime } from '../runtime/model-runtime.ts';
import { ExtensionManifestSchema, providedModelRuntime } from './extension-manifest.ts';

const runtime: ModelRuntime = {
  name: 'example-runtime',
  version: '1.2.3',
  formats: ['example'],
  capabilities: { features: true, given: true, totals: true },
  binding: { kind: 'process', module: () => new URL('file:///models/example-models.js') },
};

const decoded = Schema.decodeUnknownOption(ExtensionManifestSchema);

describe('the manifest of an extension', () => {
  it('names the package and its version, and the point each implementation fills with the contract it was built against', () => {
    const manifest = { name: '@example/models', version: '2.0.0', provides: [providedModelRuntime(runtime)] };

    expect(Option.getOrThrow(decoded(manifest)).provides).toEqual([
      { point: 'prediction/model-runtime', contract: 2, implementation: runtime },
    ]);
  });

  it('is refused without the points it provides, or with a contract that is not a whole number', () => {
    expect([
      decoded({ name: '@example/models', version: '2.0.0' }),
      decoded({ name: '@example/models', version: '2.0.0', provides: [{ point: 'p', contract: 1.5 }] }),
    ]).toEqual([Option.none(), Option.none()]);
  });
});

describe('the contract of a model runtime', () => {
  it('is version 2, and this release accepts it and version 1 before it', () => {
    expect([modelRuntimeContract, acceptedModelRuntimeContracts]).toEqual([2, { least: 1, most: 2 }]);
  });
});
