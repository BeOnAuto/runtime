import {
  AboutSchema,
  DescriptionSchema,
  type FrontMatterSection,
  type FrontMatterShape,
} from '@on.auto/definitions/document';
import { Schema } from 'effect';

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const SourceSchema = Schema.Struct({ events: Schema.Array(Schema.Json) });

const ViewSchema = Schema.Struct({
  initial: Schema.optionalKey(Schema.Json),
  schema: Schema.optionalKey(Schema.JsonObject),
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  about: Schema.optionalKey(AboutSchema),
  language: Schema.String,
  source: SourceSchema,
  view: Schema.optionalKey(ViewSchema),
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
});

export type RecallFrontMatter = typeof FrontMatterSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'source', keys: Object.keys(SourceSchema.fields) },
  { name: 'view', keys: Object.keys(ViewSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const recallFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the language and the events it folds',
};
