import type { SchemaIssue } from '@on.auto/json-schema';
import type { FinishReason as SdkFinishReason } from 'ai';
import { Array as Arr, Option, Result, type Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { JsonOutput } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import type { ModelResult, OutputMode } from '../model/model-result.ts';
import { answerValueOf } from '../schema/described-answers.ts';
import { finishReasonOf, tokenUsage, warningOf, type SdkUsage, type SdkWarning } from './answer-mapping.ts';
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
  readonly response: { readonly modelId: string; readonly messages: readonly unknown[] };
}

export type ReadOutput =
  | { readonly kind: 'text' }
  | { readonly kind: 'json'; readonly value: Schema.Json }
  | { readonly kind: 'mismatched'; readonly issues: readonly SchemaIssue[] }
  | { readonly kind: 'missing' };

export interface CallMode {
  readonly output_mode?: OutputMode;
}

export interface Generated {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage;
  readonly warnings: readonly SdkWarning[];
  readonly answeredModel: string;
  readonly responseId: string | null;
  readonly cost: { readonly cost_usd?: number };
  readonly response: string;
  readonly requestBytes: number;
}

export function projected(result: SdkResult, { id, cost }: Responded, requestBytes: number): Generated {
  return {
    text: result.text,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: result.usage,
    warnings: Arr.flatten(Arr.fromNullishOr(result.warnings)),
    answeredModel: result.response.modelId,
    responseId: id,
    cost,
    response: JSON.stringify(result.response.messages),
    requestBytes,
  };
}

function answered(target: ModelTarget, generated: Generated): Answered {
  return {
    text: generated.text,
    finish_reason: finishReasonOf(generated.finishReason),
    raw_finish_reason: generated.rawFinishReason ?? null,
    usage: tokenUsage(generated.usage),
    model: { requested: target.requested, resolved: target.resolved, answered: generated.answeredModel },
    response_id: generated.responseId,
    ...generated.cost,
    warnings: generated.warnings.map((warning) => warningOf(warning)),
    response: generated.response,
    request_bytes: generated.requestBytes,
  };
}

function issuesOf(output: ReadOutput): readonly SchemaIssue[] {
  return output.kind === 'mismatched' ? output.issues : [];
}

export function settledAnswer(
  target: ModelTarget,
  generated: Generated,
  output: ReadOutput,
  mode: CallMode = {},
): SettledAnswer {
  if (generated.finishReason === 'content-filter' || output.kind === 'missing' || output.kind === 'mismatched') {
    return Result.fail(outputFailure({ provider: target.provider, ...generated, issues: issuesOf(output), ...mode }));
  }
  const answer = { ...answered(target, generated), ...mode };
  return Result.succeed(output.kind === 'json' ? { ...answer, json: output.value } : answer);
}

export function readOutput(read: () => Schema.Json): ReadOutput {
  try {
    return { kind: 'json', value: read() };
  } catch {
    return { kind: 'missing' };
  }
}

export function describedOutput(text: string, { schema }: JsonOutput): ReadOutput {
  return Option.match(answerValueOf(text), {
    onNone: () => ({ kind: 'missing' }),
    onSome: (value) =>
      Result.match(schema.validate(value), {
        onSuccess: (json) => ({ kind: 'json', value: json }),
        onFailure: (issues) => ({ kind: 'mismatched', issues }),
      }),
  });
}
