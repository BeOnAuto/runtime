import { Schema } from 'effect';

import type { FrontMatterSection, FrontMatterShape } from '../document/front-matter-keys.ts';
import { DescriptionSchema } from '../document/function-fields.ts';

const SourceSchema = Schema.Struct({ events: Schema.Array(Schema.Json) });

const DataSchema = Schema.Struct({
  language: Schema.String,
  source: SourceSchema,
  views: Schema.Record(Schema.String, Schema.Json),
  module: Schema.String,
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  of: Schema.String,
  data: Schema.optionalKey(DataSchema),
});

export type PageFrontMatter = typeof FrontMatterSchema.Type;

export type PageDataFrontMatter = typeof DataSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'data', keys: Object.keys(DataSchema.fields) },
  { name: 'data.source', keys: Object.keys(SourceSchema.fields) },
];

export const decodePageFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const pageFrontMatter: FrontMatterShape = {
  sections,
  decode: decodePageFrontMatter,
  required: 'the subject the page presents, in of',
};
