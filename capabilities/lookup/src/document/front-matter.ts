import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { CallBlockSchema } from '@on.auto/definitions/tool-blocks';
import { Schema } from 'effect';

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const RunsBlockSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  words: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.String),
});

export type WrittenRuns = typeof RunsBlockSchema.Type;

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  call: Schema.optionalKey(CallBlockSchema),
  runs: Schema.optionalKey(RunsBlockSchema),
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
});

export type LookupFrontMatter = typeof FrontMatterSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
  { name: 'call', keys: Object.keys(CallBlockSchema.fields) },
  { name: 'runs', keys: Object.keys(RunsBlockSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const lookupFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the tool it reads through or the runs it reads',
};
