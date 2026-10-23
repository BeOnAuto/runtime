import { Result, Schema } from 'effect';

import type { FailureIssue } from '../failure/failure-issue.ts';
import { providerOf } from '../model/model-reference.ts';
import type { OutputRequest, ToolDefinition } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { inputSchemaWarnings } from '../tools/input-schema-warnings.ts';
import { answerTextOf } from './asked-calls.ts';
import type { FailedCall } from './step-decision.ts';
import type { Prompt } from './step-messages.ts';
import type { StepEnding, StepState } from './step-state.ts';

export interface StepsAnswer {
  readonly prompt: Prompt;
  readonly output: Schema.Json;
  readonly result: ModelResult;
}

export interface Answering {
  readonly model: string;
  readonly output: OutputRequest;
  readonly tools: readonly ToolDefinition[];
}

type Answered = Extract<StepEnding, { readonly type: 'answered' }>;

const jsonOf = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Json));

const scrubbedAway =
  "The answer does not match its schema once the secrets of the run's tool servers are scrubbed from it";

const notJsonAnyMore = [{ pointer: '', detail: 'The scrubbed answer is not JSON' }];

function outputOf(text: string, output: OutputRequest): Result.Result<Schema.Json, readonly FailureIssue[]> {
  if (output.type === 'text') {
    return Result.succeed(text);
  }
  return Result.match(jsonOf(text), {
    onFailure: () => Result.fail(notJsonAnyMore),
    onSuccess: (json) => output.schema.validate(json),
  });
}

function refusedAfterTheScrub({ data }: Answered, issues: readonly FailureIssue[]): FailedCall {
  const { number, resolved_model: model, duration_ms: durationMs } = data;
  return {
    number,
    because: 'output_invalid',
    provider: providerOf(model),
    detail: scrubbedAway,
    duration_ms: durationMs,
    issues,
  };
}

export function answerOfTheSteps(
  { prompt, facts: { spent } }: StepState,
  answered: Answered,
  { model, output: requested, tools }: Answering,
): Result.Result<StepsAnswer, FailedCall> {
  const { data, response } = answered;
  const text = answerTextOf(response);
  return Result.match(outputOf(text, requested), {
    onFailure: (issues) => Result.fail(refusedAfterTheScrub(answered, issues)),
    onSuccess: (output) => {
      const result: ModelResult = {
        text,
        ...(requested.type === 'json' ? { json: output } : {}),
        finish_reason: data.finish_reason,
        raw_finish_reason: data.raw_finish_reason,
        usage: spent.usage,
        model: { requested: model, resolved: data.resolved_model, answered: data.answered_model },
        response_id: data.response_id,
        ...(spent.cost_usd === undefined ? {} : { cost_usd: spent.cost_usd }),
        warnings: [...data.warnings, ...inputSchemaWarnings(tools, providerOf(data.resolved_model))],
        response: '',
        request_bytes: data.request_bytes,
        duration_ms: spent.duration_ms,
      };
      return Result.succeed({ prompt, output, result });
    },
  });
}
