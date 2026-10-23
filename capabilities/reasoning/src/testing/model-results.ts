import type { Schema } from 'effect';

import { unknownUsage, type ModelResult } from '../model/model-result.ts';

export type ScriptedCall = readonly [string, unknown];

function responseSaying(text: string): string {
  return JSON.stringify([{ role: 'assistant', content: [{ type: 'text', text }] }]);
}

export function textResult(text: string, overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    text,
    finish_reason: 'stop',
    raw_finish_reason: null,
    usage: unknownUsage,
    model: { requested: 'scripted/model', resolved: 'scripted/model', answered: 'model' },
    response_id: null,
    warnings: [],
    response: responseSaying(text),
    request_bytes: 0,
    duration_ms: 0,
    ...overrides,
  };
}

export function jsonResult(json: Schema.Json, overrides: Partial<ModelResult> = {}): ModelResult {
  return textResult(JSON.stringify(json), { ...overrides, json });
}

export function toolCallsResult(calls: readonly ScriptedCall[], overrides: Partial<ModelResult> = {}): ModelResult {
  const content = calls.map(([tool, input], index) => ({
    type: 'tool-call',
    toolCallId: `call-${index + 1}`,
    toolName: tool,
    input,
  }));
  return textResult('', {
    finish_reason: 'tool_calls',
    raw_finish_reason: 'tool_use',
    response: JSON.stringify([{ role: 'assistant', content }]),
    ...overrides,
  });
}
