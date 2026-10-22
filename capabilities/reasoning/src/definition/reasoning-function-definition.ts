import type { ToolReference } from '@on.auto/tool-servers/policy';
import type { Schema } from 'effect';

import type { GenerationSettings, OutputRequest, ProviderOptions } from '../model/model-request.ts';
import type { AnswerSchema } from '../schema/answer-schema.ts';
import type { CompiledTemplate } from '../template/compiled-template.ts';

export interface InputContract {
  readonly schema?: AnswerSchema;
  readonly defaults: Schema.JsonObject;
}

export interface ReasoningFunctionDefinitionDocument {
  readonly description?: string;
  readonly model: string;
  readonly settings: GenerationSettings;
  readonly input: InputContract;
  readonly output: OutputRequest;
  readonly provider_options?: ProviderOptions;
  readonly tools: readonly ToolReference[];
  readonly template: CompiledTemplate;
  readonly warnings: readonly string[];
}
