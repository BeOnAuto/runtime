import type {
  RenderClock,
  RenderFailure as EngineRenderFailure,
  TemplateText,
  VariableReference,
} from '@on.auto/definitions/template';
import type { Result, Schema } from 'effect';

export type { TemplateIssue } from '@on.auto/definitions/template';

export interface TemplateScope {
  readonly input: Schema.Json;
  readonly today: string;
  readonly now: string;
}

export interface RenderedPrompt {
  readonly instructions?: string;
  readonly message: string;
}

export type PromptPart = 'instructions' | 'message';

export type RenderFailure =
  | EngineRenderFailure
  | { readonly reason: 'too_long'; readonly part: PromptPart; readonly line: number };

export interface CompiledTemplate extends TemplateText {
  readonly hasInstructions: boolean;
  readonly hasMessage: boolean;
  readonly variables: readonly VariableReference[];
  readonly render: (scope: TemplateScope, clock: RenderClock) => Result.Result<RenderedPrompt, RenderFailure>;
}
