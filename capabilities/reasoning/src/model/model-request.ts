import type { OutputShape } from '@on.auto/definitions';
import type { Schema } from 'effect';

import type { AnswerSchema } from '../schema/answer-schema.ts';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export type ContentPart = TextPart;

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly ContentPart[];
}

export interface TextOutput {
  readonly type: 'text';
}

export interface JsonOutput {
  readonly type: 'json';
  readonly schema: AnswerSchema;
  readonly shape?: OutputShape;
  readonly name?: string;
  readonly description?: string;
}

export type OutputRequest = TextOutput | JsonOutput;

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface GenerationSettings {
  readonly max_output_tokens: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly seed?: number;
  readonly stop_sequences?: readonly string[];
  readonly reasoning?: ReasoningEffort;
}

export interface ProviderOptions {
  readonly [namespace: string]: Schema.JsonObject;
}

export type RetryOwner = 'adapter' | 'caller';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
}

export interface ModelRequest {
  readonly model: string;
  readonly instructions?: string;
  readonly messages: readonly ModelMessage[];
  readonly conversation?: readonly Schema.JsonObject[];
  readonly tools?: readonly ToolDefinition[];
  readonly output: OutputRequest;
  readonly settings: GenerationSettings;
  readonly provider_options?: ProviderOptions;
  readonly timeout_ms?: number;
  readonly retries?: RetryOwner;
  readonly run_id?: string;
}
