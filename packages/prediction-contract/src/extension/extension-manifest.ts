import { Schema } from 'effect';

import { modelRuntimeContract, modelRuntimePoint } from '../contract/model-runtime-point.ts';
import type { ModelRuntime } from '../runtime/model-runtime.ts';

const ProvisionSchema = Schema.Struct({
  point: Schema.String.check(Schema.isMinLength(1)),
  contract: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  implementation: Schema.Unknown,
});

export const ExtensionManifestSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(214)),
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  provides: Schema.Array(ProvisionSchema),
});

export type ExtensionManifest = typeof ExtensionManifestSchema.Type;

export type Provision = ExtensionManifest['provides'][number];

export interface ModelRuntimeProvision extends Provision {
  readonly point: typeof modelRuntimePoint;
  readonly implementation: ModelRuntime;
}

export function providedModelRuntime(runtime: ModelRuntime): ModelRuntimeProvision {
  return { point: modelRuntimePoint, contract: modelRuntimeContract, implementation: runtime };
}
