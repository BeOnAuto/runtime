import { Schema } from 'effect';

const formatPattern = /^[a-z][a-z0-9-]{0,31}$/u;

export const FormatSchema = Schema.String.check(
  Schema.isPattern(formatPattern, {
    message: 'Expected a format: a lower-case letter, then at most 31 lower-case letters, digits and hyphens',
  }),
);

function isModuleAddress(value: unknown): value is () => URL {
  return typeof value === 'function';
}

const ModuleAddressSchema = Schema.declare(isModuleAddress, {
  expected: 'a function that answers the URL of the module',
});

const CapabilitiesSchema = Schema.Struct({
  features: Schema.Boolean,
  given: Schema.Boolean,
  totals: Schema.Boolean,
});

const ProcessBindingSchema = Schema.Struct({ kind: Schema.Literal('process'), module: ModuleAddressSchema });

export const ModelRuntimeSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  formats: Schema.Array(FormatSchema).check(Schema.isMinLength(1)),
  capabilities: CapabilitiesSchema,
  binding: Schema.Union([ProcessBindingSchema]),
});

export type ModelRuntime = typeof ModelRuntimeSchema.Type;

export type ModelRuntimeBinding = ModelRuntime['binding'];

export type ModelRuntimeCapabilities = ModelRuntime['capabilities'];
