import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { Schema } from 'effect';

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const OutputSectionSchema = Schema.Struct({
  schema: Schema.optionalKey(Schema.JsonObject),
  shape: Schema.optionalKey(Schema.String),
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  language: Schema.String,
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(OutputSectionSchema),
});

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(OutputSectionSchema.fields) },
];

export type OutputSection = typeof OutputSectionSchema.Type | undefined;

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const computationFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the language',
};
