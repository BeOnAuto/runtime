import type { SchemaIssue } from '@on.auto/json-schema';
import type { FinishReason as SdkFinishReason } from 'ai';
import { Array as Arr, Option, Result, type Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { JsonOutput } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import {
  addedUsage,
  unknownUsage,
  type ModelResult,
  type OutputMode,
  type Repair,
  type RepairFailedBecause,
  type SchemaRefusal,
  type TokenUsage,
} from '../model/model-result.ts';
import { answerValueOf } from '../schema/described-answers.ts';
import { finishReasonOf, tokenUsage, warningOf, type SdkUsage, type SdkWarning } from './answer-mapping.ts';
import { mismatchOf, outputFailure } from './output-failure.ts';

export type Answered = Omit<ModelResult, 'duration_ms'>;

export type SettledAnswer = Result.Result<Answered, ModelFailure>;

export interface Responded {
  readonly id: string | null;
  readonly cost: { readonly cost_usd?: number };
  readonly refused: boolean;
  readonly warnings: readonly SdkWarning[];
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
  | { readonly kind: 'mismatched'; readonly issues: readonly SchemaIssue[]; readonly written: readonly SchemaIssue[] }
  | { readonly kind: 'missing' };

export interface CallMode {
  readonly output_mode?: OutputMode;
  readonly repair?: Repair;
  readonly schema_refusal?: SchemaRefusal;
}

export interface Generated {
  readonly text: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: TokenUsage;
  readonly warnings: readonly SdkWarning[];
  readonly answeredModel: string;
  readonly responseId: string | null;
  readonly cost: { readonly cost_usd?: number };
  readonly refused: boolean;
  readonly response: string;
  readonly requestBytes: number;
}

export function projected(result: SdkResult, { id, cost, refused }: Responded, requestBytes: number): Generated {
  return {
    text: result.text,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: tokenUsage(result.usage),
    warnings: Arr.flatten(Arr.fromNullishOr(result.warnings)),
    answeredModel: result.response.modelId,
    responseId: id,
    cost,
    refused,
    response: JSON.stringify(result.response.messages),
    requestBytes,
  };
}

export interface UnreadAnswer {
  readonly generated: Generated;
  readonly output: ReadOutput;
}

export interface UnreadReply {
  readonly text: string | undefined;
  readonly finishReason: SdkFinishReason | undefined;
  readonly usage: SdkUsage | undefined;
  readonly modelId: string | undefined;
  readonly cause: unknown;
}

export function unreadAnswerOf(
  target: ModelTarget,
  { text, finishReason, usage, modelId, cause }: UnreadReply,
  { id, cost, refused, warnings }: Responded,
  requestBytes: number,
): UnreadAnswer {
  const mismatch = mismatchOf(cause);
  const generated: Generated = {
    text: text ?? '',
    finishReason: finishReason ?? 'other',
    rawFinishReason: undefined,
    usage: usage === undefined ? unknownUsage : tokenUsage(usage),
    warnings,
    answeredModel: modelId ?? target.resolved,
    responseId: id,
    cost,
    refused,
    response: '[]',
    requestBytes,
  };
  const output: ReadOutput =
    mismatch === undefined
      ? { kind: 'missing' }
      : { kind: 'mismatched', issues: mismatch.issues, written: mismatch.written };
  return { generated, output };
}

function answered(target: ModelTarget, generated: Generated): Answered {
  return {
    text: generated.text,
    finish_reason: finishReasonOf(generated.finishReason),
    raw_finish_reason: generated.rawFinishReason ?? null,
    usage: generated.usage,
    model: { requested: target.requested, resolved: target.resolved, answered: generated.answeredModel },
    response_id: generated.responseId,
    ...generated.cost,
    warnings: generated.warnings.map((warning) => warningOf(warning)),
    response: generated.response,
    request_bytes: generated.requestBytes,
  };
}

export function issuesOf(output: ReadOutput): readonly SchemaIssue[] {
  return output.kind === 'mismatched' ? output.issues : [];
}

export function writtenIssuesOf(output: ReadOutput): readonly SchemaIssue[] {
  return output.kind === 'mismatched' ? output.written : [];
}

function isUnusable(output: ReadOutput): boolean {
  return output.kind === 'missing' || output.kind === 'mismatched';
}

export function isAnswer({ finishReason }: Generated, output: ReadOutput): boolean {
  return finishReason !== 'content-filter' && !isUnusable(output);
}

export function settledAnswer(
  target: ModelTarget,
  generated: Generated,
  output: ReadOutput,
  mode: CallMode = {},
): SettledAnswer {
  if (!isAnswer(generated, output)) {
    const { provider } = target;
    return Result.fail(outputFailure({ provider, ...generated, ...generated.cost, issues: issuesOf(output), ...mode }));
  }
  const answer = { ...answered(target, generated), ...mode };
  return Result.succeed(output.kind === 'json' ? { ...answer, json: output.value } : answer);
}

const unrepairedFinishes: ReadonlySet<SdkFinishReason> = new Set(['length', 'content-filter']);

export function isRepairable({ text, finishReason, refused }: Generated, output: ReadOutput): boolean {
  return isUnusable(output) && !unrepairedFinishes.has(finishReason) && !refused && text.trim() !== '';
}

function costOfBoth(first: Generated, second: Generated): { readonly cost_usd?: number } {
  const costs = [first.cost.cost_usd, second.cost.cost_usd].filter((cost) => cost !== undefined);
  return costs.length === 0 ? {} : { cost_usd: costs.reduce((total, cost) => total + cost, 0) };
}

function warningsOfBoth(first: Generated, second: Generated): readonly SdkWarning[] {
  const both = [...first.warnings, ...second.warnings];
  return [...new Map(both.map((warning) => [JSON.stringify(warning), warning])).values()];
}

export function correctedOf(first: Generated, second: Generated): Generated {
  return {
    ...second,
    usage: addedUsage(first.usage, second.usage),
    warnings: warningsOfBoth(first, second),
    cost: costOfBoth(first, second),
    requestBytes: first.requestBytes + second.requestBytes,
  };
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
        onFailure: (issues) => ({ kind: 'mismatched', issues, written: issues }),
      }),
  });
}

interface Unrepaired {
  readonly generated: Generated;
  readonly output: ReadOutput;
  readonly mode: CallMode;
  readonly issues: readonly SchemaIssue[];
  readonly askedAt: number;
}

export class RepairFailed extends Error {
  readonly unrepaired: Unrepaired;

  constructor(unrepaired: Unrepaired, cause: unknown) {
    super('The request that asked for the answer once more failed', { cause });
    this.name = 'RepairFailed';
    this.unrepaired = unrepaired;
  }
}

export function failedRepairOf(
  target: ModelTarget,
  { generated, output, mode, issues, askedAt }: Unrepaired,
  because: RepairFailedBecause,
  failedAt: number,
): SettledAnswer {
  const repair = { outcome: 'failed' as const, because, issues, duration_ms: failedAt - askedAt };
  return settledAnswer(target, generated, output, { ...mode, repair });
}
