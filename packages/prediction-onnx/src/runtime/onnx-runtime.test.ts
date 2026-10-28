import { readFileSync } from 'node:fs';

import { modelRuntimePoint } from '@on.auto/prediction';
import { acceptedModelRuntimeContracts, ExtensionManifestSchema } from '@on.auto/prediction-contract';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { manifest } from '../index.ts';
import { onnxRuntime } from './onnx-runtime.ts';

const VersionSchema = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const ofTheSessions: unknown = expect.stringMatching(/\/prediction-onnx\/src\/sessions\/model-sessions\.ts$/u);

function versionIn(manifestFile: Readonly<URL>): string {
  return Schema.decodeUnknownSync(VersionSchema)(readFileSync(manifestFile, 'utf8')).version;
}

describe('the extension of the release that executes ONNX', () => {
  it('names its package and the release, and fills prediction/model-runtime with the contract it was built against', () => {
    const decoded = Schema.decodeUnknownSync(ExtensionManifestSchema)(manifest);
    const [provided] = decoded.provides;

    expect([decoded.name, decoded.version]).toEqual([
      '@on.auto/prediction-onnx',
      versionIn(new URL('../../../../package.json', import.meta.url)),
    ]);
    expect([provided?.point, provided?.contract]).toEqual([
      'prediction/model-runtime',
      acceptedModelRuntimeContracts.most,
    ]);
    expect(modelRuntimePoint.implementationOf(provided?.implementation)).toEqual(Result.succeed(onnxRuntime));
  });

  it('executes the format onnx in onnxruntime-node, at the version installed, through its sessions in a model process', () => {
    expect({ ...onnxRuntime, binding: onnxRuntime.binding.module().pathname }).toEqual({
      name: 'onnxruntime-node',
      version: versionIn(new URL('../../node_modules/onnxruntime-node/package.json', import.meta.url)),
      formats: ['onnx'],
      capabilities: { features: true, given: true, totals: true },
      binding: ofTheSessions,
    });
  });
});
