import { Schema } from 'effect';

import type { ModelMessage } from '../model/model-request.ts';

const TextPartSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String });

const ModelMessageSchema = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  content: Schema.Array(TextPartSchema),
});

const PromptSchema = Schema.Struct({
  kind: Schema.Literal('prompt'),
  instructions: Schema.optionalKey(Schema.String),
  message: Schema.String,
});

const StepMessagesSchema = Schema.Union([
  PromptSchema,
  Schema.Struct({ kind: Schema.Literal('results'), messages: Schema.Array(Schema.JsonObject) }),
  Schema.Struct({ kind: Schema.Literal('retold'), messages: Schema.Array(ModelMessageSchema) }),
]);

export type StepMessages = typeof StepMessagesSchema.Type;

export type Prompt = typeof PromptSchema.Type;

export const stepMessagesOf = Schema.decodeUnknownSync(Schema.fromJsonString(StepMessagesSchema));

export const promptIn = Schema.decodeUnknownOption(Schema.fromJsonString(PromptSchema));

export const responseOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.JsonObject)));

export function promptMessages({ message }: Prompt): readonly ModelMessage[] {
  return [{ role: 'user', content: [{ type: 'text', text: message }] }];
}
