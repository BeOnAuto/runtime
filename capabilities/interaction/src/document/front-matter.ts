import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { CallBlockSchema } from '@on.auto/definitions/tool-blocks';
import { Schema } from 'effect';

import { WrittenRuleSchema } from '../replies/reply-rule.ts';
import {
  DeliverBlockSchema,
  DeliverSchema,
  EachSchema,
  ReadSchema,
  RepliesSchema,
  SentSchema,
  TellSchema,
} from '../tool-blocks/tool-block-schemas.ts';

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const ifSignedOutAnswers = ['ask', 'fail'] as const;

const SignInSchema = Schema.Struct({
  server: Schema.String,
  site: Schema.String,
  if_signed_out: Schema.optionalKey(
    Schema.Literals(ifSignedOutAnswers).annotate({ expected: 'ask, to wait for the person, or fail, to stop at once' }),
  ),
});

export type WrittenSignIn = typeof SignInSchema.Type;

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  call: Schema.optionalKey(CallBlockSchema),
  sign_in: Schema.optionalKey(SignInSchema),
  to: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.String),
  expires: Schema.optionalKey(Schema.String),
  deliver: Schema.optionalKey(DeliverSchema),
  replies: Schema.optionalKey(RepliesSchema),
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
  reply: Schema.optionalKey(WrittenRuleSchema),
});

export type InteractionFrontMatter = typeof FrontMatterSchema.Type;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
  { name: 'call', keys: Object.keys(CallBlockSchema.fields) },
  { name: 'sign_in', keys: Object.keys(SignInSchema.fields) },
  { name: 'deliver', keys: Object.keys(DeliverBlockSchema.fields) },
  { name: 'deliver.sent', keys: Object.keys(SentSchema.fields) },
  { name: 'replies', keys: Object.keys(RepliesSchema.fields) },
  { name: 'replies.read', keys: Object.keys(ReadSchema.fields) },
  { name: 'replies.read.each', keys: Object.keys(EachSchema.fields) },
  { name: 'replies.tell', keys: Object.keys(TellSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const interactionFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the tool it calls, the party it goes to and when it expires, or the site a person signs in to',
};
