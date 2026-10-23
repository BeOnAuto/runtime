import type { FinishReason as SdkFinishReason } from 'ai';
import { Array as Arr, Result, type Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelTools } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { inputSchemaWarnings } from '../tools/input-schema-warnings.ts';
import { finishReasonOf, tokenUsage, warningOf, type SdkUsage, type SdkWarning } from './answer-mapping.ts';
import type { ModelTarget } from './model-resolution.ts';
import { outputFailure } from './output-failure.ts';

export type Answered = Omit<ModelResult, 'duration_ms'>;

export type SettledAnswer = Result.Result<Answered, ModelFailure>;

export interface Responded {
  readonly id: string | null;
  readonly cost: { readonly cost_usd?: number };
}

export interface SdkResult {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage;
  readonly warnings: readonly SdkWarning[] | undefined;
  readonly response: { readonly modelId: string };
}

export type ReadOutput =
  | { readonly kind: 'text' }
  | { readonly kind: 'json'; readonly value: Schema.Json }
  | { readonly kind: 'missing' };

export interface Generated {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage;
  readonly warnings: readonly SdkWarning[];
  readonly answeredModel: string;
  readonly responseId: string | null;
  readonly cost: { readonly cost_usd?: number };
}

export function projected(result: SdkResult, { id, cost }: Responded): Generated {
  return {
    text: result.text,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: result.usage,
    warnings: Arr.flatten(Arr.fromNullishOr(result.warnings)),
    answeredModel: result.response.modelId,
    responseId: id,
    cost,
  };
}

function answered(target: ModelTarget, generated: Generated, tools: ModelTools | undefined): Answered {
  return {
    text: generated.text,
    finish_reason: finishReasonOf(generated.finishReason),
    raw_finish_reason: generated.rawFinishReason ?? null,
    usage: tokenUsage(generated.usage),
    model: { requested: target.requested, resolved: target.resolved, answered: generated.answeredModel },
    response_id: generated.responseId,
    ...generated.cost,
    warnings: [
      ...generated.warnings.map((warning) => warningOf(warning)),
      ...inputSchemaWarnings(tools, target.provider),
    ],
  };
}

export function settledAnswer(
  target: ModelTarget,
  generated: Generated,
  output: ReadOutput,
  tools: ModelTools | undefined,
): SettledAnswer {
  if (generated.finishReason === 'content-filter' || output.kind === 'missing') {
    return Result.fail(outputFailure({ provider: target.provider, ...generated, cause: undefined }));
  }
  const answer = answered(target, generated, tools);
  return Result.succeed(output.kind === 'json' ? { ...answer, json: output.value } : answer);
}

export function readOutput(read: () => Schema.Json): ReadOutput {
  try {
    return { kind: 'json', value: read() };
  } catch {
    return { kind: 'missing' };
  }
}
