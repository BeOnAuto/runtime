import { Buffer } from 'node:buffer';

import { mostResultBytes, type Finished } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { GenerationSettings, OutputRequest } from '../model/model-request.ts';
import type { FinishReason, ModelResult, TokenUsage } from '../model/model-result.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

export interface Answered {
  readonly prompt: RenderedPrompt;
  readonly settings: GenerationSettings;
  readonly format: OutputRequest['type'];
  readonly result: ModelResult;
}

interface RecordFields {
  readonly model: Schema.JsonObject;
  readonly settings: Schema.JsonObject;
  readonly output_format: OutputRequest['type'];
  readonly finish_reason: FinishReason;
  readonly raw_finish_reason: string | null;
  readonly usage: Schema.JsonObject;
  readonly response_id: string | null;
  readonly cost_usd?: number;
  readonly warnings: readonly Schema.JsonObject[];
  readonly duration_ms: number;
}

const mostWarnings = 20;

const keysAndQuotes = 128;

const leastPromptBytes = 1024;

function jsonBytes(value: Schema.Json): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function prefixWithin(text: string, bytes: number): string {
  let kept = 0;
  let tried = text.length;
  while (kept < tried) {
    const middle = Math.ceil((kept + tried) / 2);
    if (jsonBytes(text.slice(0, middle)) <= bytes) {
      kept = middle;
    } else {
      tried = middle - 1;
    }
  }
  return text.slice(0, kept);
}

function usageRecord({ input, output, total }: TokenUsage): Schema.JsonObject {
  return {
    input: {
      total: input.total,
      uncached: input.uncached,
      cache_read: input.cache_read,
      cache_write: input.cache_write,
    },
    output: { total: output.total, text: output.text, reasoning: output.reasoning },
    total,
  };
}

export function spendingRecord(
  usage: TokenUsage,
  durationMs: number,
  { cost_usd: cost }: { readonly cost_usd?: number } = {},
): Schema.JsonObject {
  return { usage: usageRecord(usage), duration_ms: durationMs, ...(cost === undefined ? {} : { cost_usd: cost }) };
}

function recordFields({ settings, format, result }: Answered): RecordFields {
  const { requested, resolved, answered } = result.model;
  const { stop_sequences: stopSequences, ...numbers } = settings;
  return {
    model: { requested, resolved, answered },
    settings: stopSequences === undefined ? numbers : { ...numbers, stop_sequences: [...stopSequences] },
    output_format: format,
    finish_reason: result.finish_reason,
    raw_finish_reason: result.raw_finish_reason,
    usage: usageRecord(result.usage),
    response_id: result.response_id,
    ...(result.cost_usd === undefined ? {} : { cost_usd: result.cost_usd }),
    warnings: result.warnings.slice(0, mostWarnings).map(({ type, feature, detail }) => ({ type, feature, detail })),
    duration_ms: result.duration_ms,
  };
}

function promptWithin({ instructions, message }: RenderedPrompt, bytes: number): Schema.JsonObject {
  const whole = instructions === undefined ? { message } : { instructions, message };
  if (jsonBytes(whole) + keysAndQuotes <= bytes) {
    return { ...whole, truncated: false };
  }
  const share = (instructions === undefined ? bytes : Math.floor(bytes / 2)) - keysAndQuotes;
  const clippedMessage = prefixWithin(message, share);
  return instructions === undefined
    ? { message: clippedMessage, truncated: true }
    : { instructions: prefixWithin(instructions, share), message: clippedMessage, truncated: true };
}

export function finishedWith(output: Schema.Json, answered: Answered): Effect.Effect<Finished, Conflict> {
  const fields = recordFields(answered);
  const room = mostResultBytes - jsonBytes(output) - jsonBytes({ ...fields }) - keysAndQuotes;
  return room < leastPromptBytes
    ? Effect.fail(
        new Conflict({
          detail: `The answer takes more than a run can record (${mostResultBytes} bytes with its record); lower config.max_output_tokens in the reasoning function definition`,
          kind: 'unworkable',
          record: spendingRecord(answered.result.usage, answered.result.duration_ms, answered.result),
        }),
      )
    : Effect.succeed({ output, record: { ...fields, prompt: promptWithin(answered.prompt, room) } });
}
