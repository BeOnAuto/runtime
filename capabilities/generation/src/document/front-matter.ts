import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { Schema } from 'effect';

import type { GenerationKind } from '../catalog/catalog-entry.ts';
import type { ParameterName } from './generation-document.ts';

const ParameterTextSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32));

const ParametersSchema = Schema.Struct({
  size: Schema.optionalKey(ParameterTextSchema),
  aspect: Schema.optionalKey(ParameterTextSchema),
  quality: Schema.optionalKey(ParameterTextSchema),
  voice: Schema.optionalKey(ParameterTextSchema),
  format: Schema.optionalKey(ParameterTextSchema),
  duration: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});

const InputSectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const mostReferencesWritten = 16;

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  produces: Schema.String,
  model: Schema.String,
  input: Schema.optionalKey(InputSectionSchema),
  parameters: Schema.optionalKey(ParametersSchema),
  references: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(mostReferencesWritten))),
  expires: Schema.optionalKey(Schema.String),
});

export type FrontMatter = typeof FrontMatterSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(InputSectionSchema.fields) },
  { name: 'parameters', keys: Object.keys(ParametersSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const generationFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'what it produces and the model',
};

export const parametersOfKind: Readonly<Record<GenerationKind, readonly ParameterName[]>> = {
  image: ['size', 'aspect', 'quality'],
  audio: ['voice', 'format', 'duration'],
  video: ['size', 'aspect', 'duration'],
};
