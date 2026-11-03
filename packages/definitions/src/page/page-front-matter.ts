import { Schema } from 'effect';

import type { FrontMatterSection, FrontMatterShape } from '../document/front-matter-keys.ts';
import { DescriptionSchema } from '../document/function-fields.ts';

export const PageSourceSchema = Schema.Struct({ events: Schema.Array(Schema.Json) });

export const PageDataSchema = Schema.Struct({
  language: Schema.String,
  source: PageSourceSchema,
  views: Schema.Record(Schema.String, Schema.Json),
  module: Schema.String,
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  data: Schema.optionalKey(PageDataSchema),
});

export type PageFrontMatter = typeof FrontMatterSchema.Type;

export type PageDataFrontMatter = typeof PageDataSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'data', keys: Object.keys(PageDataSchema.fields) },
  { name: 'data.source', keys: Object.keys(PageSourceSchema.fields) },
];

export const decodePageFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const pageFrontMatter: FrontMatterShape = {
  sections,
  decode: decodePageFrontMatter,
};
