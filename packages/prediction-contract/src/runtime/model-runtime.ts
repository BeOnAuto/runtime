import { Schema } from 'effect';

const namePattern = /^[a-z][a-z0-9-]{0,31}$/u;

function nameOf(what: string) {
  return Schema.String.check(
    Schema.isPattern(namePattern, {
      message: `Expected ${what}: a lower-case letter, then at most 31 lower-case letters, digits and hyphens`,
    }),
  );
}

export const FormatSchema = nameOf('a format');

export const FeatureSchema = nameOf('a feature');

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
  calendar: Schema.optionalKey(Schema.Boolean),
  fits: Schema.optionalKey(Schema.Boolean),
});

const ProcessBindingSchema = Schema.Struct({ kind: Schema.Literal('process'), module: ModuleAddressSchema });

const InlineBindingSchema = Schema.Struct({ kind: Schema.Literal('inline'), module: ModuleAddressSchema });

export const ModelRuntimeSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  formats: Schema.Array(FormatSchema).check(Schema.isMinLength(1)),
  capabilities: CapabilitiesSchema,
  binding: Schema.Union([ProcessBindingSchema, InlineBindingSchema]),
  feature: Schema.optionalKey(FeatureSchema),
});

export type ModelRuntime = typeof ModelRuntimeSchema.Type;

export type ModelRuntimeBinding = ModelRuntime['binding'];

export type ModelRuntimeCapabilities = ModelRuntime['capabilities'];
