import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { CallBlockSchema } from '@on.auto/definitions/tool-blocks';
import { Schema } from 'effect';

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  call: CallBlockSchema,
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
});

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
  { name: 'call', keys: Object.keys(CallBlockSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const lookupFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the tool it reads through',
};
