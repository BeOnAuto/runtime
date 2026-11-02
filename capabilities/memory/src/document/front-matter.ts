import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { Schema } from 'effect';

const InputSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const AboutSchema = Schema.Struct({ from: Schema.String, to: Schema.String });

const RememberSchema = Schema.Struct({
  text: Schema.String,
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  scope: Schema.optionalKey(Schema.String),
  about: Schema.optionalKey(AboutSchema),
  expires: Schema.optionalKey(Schema.String),
  replaces: Schema.optionalKey(Schema.String),
});

const RecallSchema = Schema.Struct({
  words: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  scope: Schema.optionalKey(Schema.String),
  most_characters: Schema.optionalKey(Schema.Int),
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  input: Schema.optionalKey(InputSchema),
  remember: Schema.optionalKey(RememberSchema),
  recall: Schema.optionalKey(RecallSchema),
});

export type MemoryFrontMatter = typeof FrontMatterSchema.Type;

export type WrittenRemember = typeof RememberSchema.Type;

export type WrittenRecall = typeof RecallSchema.Type;

export type WrittenAbout = typeof AboutSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(InputSchema.fields) },
  { name: 'remember', keys: Object.keys(RememberSchema.fields) },
  { name: 'remember.about', keys: Object.keys(AboutSchema.fields) },
  { name: 'recall', keys: Object.keys(RecallSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const memoryFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'a remember block or a recall block',
};
