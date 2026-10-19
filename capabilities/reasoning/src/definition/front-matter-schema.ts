import {
  AboutSchema,
  DescriptionSchema,
  frontMatterIn as sharedFrontMatterIn,
  type DocumentIssue,
  type FrontMatterSection,
  type ReadFrontMatter,
} from '@on.auto/definitions/document';
import { Schema, type Result } from 'effect';

import type { ReasoningEffort } from '../model/model-request.ts';

const reasoningEfforts = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

const ConfigSchema = Schema.Struct({
  max_output_tokens: Schema.optionalKey(Schema.Number),
  temperature: Schema.optionalKey(Schema.Number),
  top_p: Schema.optionalKey(Schema.Number),
  seed: Schema.optionalKey(Schema.Number),
  stop_sequences: Schema.optionalKey(Schema.Array(Schema.String)),
  reasoning: Schema.optionalKey(Schema.Literals(reasoningEfforts)),
});

const InputSectionSchema = Schema.Struct({
  schema: Schema.optionalKey(Schema.JsonObject),
  default: Schema.optionalKey(Schema.JsonObject),
});

const OutputSectionSchema = Schema.Struct({
  format: Schema.optionalKey(Schema.Literals(['text', 'json'])),
  schema: Schema.optionalKey(Schema.JsonObject),
  shape: Schema.optionalKey(Schema.String),
});

const ProviderOptionsSchema = Schema.Record(Schema.String, Schema.JsonObject);

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  about: Schema.optionalKey(AboutSchema),
  model: Schema.String,
  config: Schema.optionalKey(ConfigSchema),
  input: Schema.optionalKey(InputSectionSchema),
  output: Schema.optionalKey(OutputSectionSchema),
  provider_options: Schema.optionalKey(ProviderOptionsSchema),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type ConfigSection = typeof ConfigSchema.Type | undefined;

export type InputSection = typeof InputSectionSchema.Type | undefined;

export type OutputSection = typeof OutputSectionSchema.Type | undefined;

export const decodeSection = {
  description: Schema.decodeUnknownOption(Schema.UndefinedOr(DescriptionSchema)),
  about: Schema.decodeUnknownOption(Schema.UndefinedOr(AboutSchema)),
  model: Schema.decodeUnknownOption(Schema.String),
  config: Schema.decodeUnknownOption(Schema.UndefinedOr(ConfigSchema)),
  input: Schema.decodeUnknownOption(Schema.UndefinedOr(InputSectionSchema)),
  output: Schema.decodeUnknownOption(Schema.UndefinedOr(OutputSectionSchema)),
  provider_options: Schema.decodeUnknownOption(Schema.UndefinedOr(ProviderOptionsSchema)),
  tools: Schema.decodeUnknownOption(Schema.UndefinedOr(Schema.Array(Schema.String))),
};

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'config', keys: Object.keys(ConfigSchema.fields) },
  { name: 'input', keys: Object.keys(InputSectionSchema.fields) },
  { name: 'output', keys: Object.keys(OutputSectionSchema.fields) },
];

const shape = {
  sections,
  decode: Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' }),
  required: 'the model',
};

export function frontMatterIn(
  text: string,
  firstLine: number,
): Result.Result<ReadFrontMatter, readonly DocumentIssue[]> {
  return sharedFrontMatterIn(text, firstLine, shape);
}
