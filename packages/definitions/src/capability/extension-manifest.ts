import { Schema } from 'effect';

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
