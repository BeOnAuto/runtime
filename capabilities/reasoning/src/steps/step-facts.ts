import type { AskedToolCall, ModelCallAnsweredData, ModelCallFailedData } from '@on.auto/definitions';
import type { ToolReference } from '@on.auto/tool-servers/policy';
import { Predicate, type Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelCallRequest } from '../jobs/jobs.ts';
import type { ToolDefinition } from '../model/model-request.ts';
import type { FinishReason, ModelResult, TokenUsage } from '../model/model-result.ts';
import { askedIn } from './asked-calls.ts';
import { promptMessages, type Prompt, type StepMessages } from './step-messages.ts';
import type { StepState } from './step-state.ts';

const mostWarnings = 20;

const mostIssues = 5;

export interface Kept {
  readonly bytes: number;
  readonly sha256?: string;
}

export interface Offered {
  readonly references: ReadonlyMap<string, ToolReference>;
  readonly argumentsDigest?: (input: unknown) => string;
}

function askedToolCalls(response: readonly Schema.JsonObject[], { references, argumentsDigest }: Offered) {
  return askedIn(response).map(({ callId, tool, input }): AskedToolCall => {
    const reference = references.get(tool);
    const named = reference?.tool ?? tool;
    const server = reference?.server ?? '';
    return argumentsDigest === undefined
      ? { call_id: callId, tool: named, server }
      : { call_id: callId, tool: named, server, arguments_sha256: argumentsDigest(input) };
  });
}

export interface Answering {
  readonly result: ModelResult;
  readonly response: readonly Schema.JsonObject[];
  readonly kept: Kept;
}

export function answeredData({ result, response, kept }: Answering, offered: Offered): ModelCallAnsweredData {
  return {
    finish_reason: result.finish_reason,
    raw_finish_reason: result.raw_finish_reason,
    usage: result.usage,
    ...(result.cost_usd === undefined ? {} : { cost_usd: result.cost_usd }),
    response_id: result.response_id,
    duration_ms: result.duration_ms,
    request_bytes: result.request_bytes,
    response_bytes: kept.bytes,
    ...(kept.sha256 === undefined ? {} : { response_sha256: kept.sha256 }),
    resolved_model: result.model.resolved,
    answered_model: result.model.answered,
    warnings: result.warnings.slice(0, mostWarnings),
    tool_calls: askedToolCalls(response, offered),
  };
}

export interface FailureOfACall {
  readonly _tag: ModelFailure['_tag'];
  readonly detail: string;
  readonly provider: string | null;
  readonly usage?: TokenUsage | null;
  readonly finish_reason?: FinishReason;
  readonly retry_after_ms?: number | null;
  readonly provider_message?: string | null;
  readonly issues?: ModelCallFailedData['issues'];
}

export type FailedFields = Omit<ModelCallFailedData, 'duration_ms' | 'because'> & {
  readonly because: ModelFailure['_tag'];
};

export function failedData(failure: FailureOfACall, provider: string): FailedFields {
  const { _tag: because, detail, usage, finish_reason: finish, retry_after_ms: wait, provider_message: said } = failure;
  const { issues } = failure;
  return {
    because,
    provider: failure.provider ?? provider,
    detail,
    ...(Predicate.isNotNullish(usage) ? { usage } : {}),
    ...(Predicate.isNotNullish(finish) ? { finish_reason: finish } : {}),
    ...(Predicate.isNotNullish(wait) ? { retry_after_ms: wait } : {}),
    ...(Predicate.isNotNullish(said) ? { provider_message: said } : {}),
    ...(issues === undefined ? {} : { issues: issues.slice(0, mostIssues) }),
  };
}

export type RequestBase = Omit<ModelCallRequest, 'instructions' | 'messages' | 'conversation' | 'tools'>;

function promptOf({ instructions }: Prompt): Pick<ModelCallRequest, 'instructions'> {
  return instructions === undefined ? {} : { instructions };
}

export function requestOf(base: RequestBase, state: StepState, tools: readonly ToolDefinition[]): ModelCallRequest {
  if (state.retold !== null) {
    return { ...base, ...promptOf(state.prompt), messages: state.retold };
  }
  return {
    ...base,
    ...promptOf(state.prompt),
    messages: promptMessages(state.prompt),
    ...(state.conversation.length === 0 ? {} : { conversation: state.conversation }),
    ...(tools.length === 0 ? {} : { tools }),
  };
}

export function sentText(sent: StepMessages): string {
  return JSON.stringify(sent);
}
