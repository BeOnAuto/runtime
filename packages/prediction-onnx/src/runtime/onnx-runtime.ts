import { providedModelRuntime, type ExtensionManifest, type ModelRuntime } from '@on.auto/prediction-contract';
import { version } from 'onnxruntime-node/dist/version.js';

import release from '../../../../package.json' with { type: 'json' };

export const onnxRuntime: ModelRuntime = {
  name: 'onnxruntime-node',
  version,
  formats: ['onnx'],
  capabilities: { features: true, given: true, totals: true },
  binding: { kind: 'process', module: () => new URL('../sessions/model-sessions.ts', import.meta.url) },
};

export const manifest: ExtensionManifest = {
  name: '@on.auto/prediction-onnx',
  version: release.version,
  provides: [providedModelRuntime(onnxRuntime)],
};
