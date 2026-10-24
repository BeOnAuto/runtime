import type { ModelCallAnsweredData, ModelCallFailedData, ModelCallStartedData, ModelUsage } from '../index.ts';

const usageOfACall: ModelUsage = {
  input: { total: 120, uncached: 20, cache_read: 90, cache_write: 10 },
  output: { total: 40, text: 15, reasoning: 25 },
  total: 160,
};

export function modelCallSent(toolsOffered = 1): ModelCallStartedData {
  return {
    model: 'anthropic/claude-sonnet-4-5',
    messages_bytes: 182,
    messages_sha256: 'c'.repeat(64),
    tools_offered: toolsOffered,
  };
}

export function modelCallAnswered(toolCalls = 1): ModelCallAnsweredData {
  return {
    finish_reason: toolCalls === 0 ? 'stop' : 'tool_calls',
    raw_finish_reason: toolCalls === 0 ? 'end_turn' : 'tool_use',
    usage: usageOfACall,
    cost_usd: 0.00042,
    response_id: 'msg_01',
    duration_ms: 410,
    request_bytes: 240,
    response_bytes: 96,
    response_sha256: 'd'.repeat(64),
    resolved_model: 'anthropic/claude-sonnet-4-5',
    answered_model: 'claude-sonnet-4-5-20250929',
    warnings: [],
    tool_calls: Array.from({ length: toolCalls }, (_, index) => ({
      call_id: `toolu_0${index + 1}`,
      tool: 'search',
      server: 'graph',
      arguments_sha256: 'e'.repeat(64),
    })),
  };
}

export const modelCallTimedOut: ModelCallFailedData = {
  because: 'timed_out',
  provider: 'anthropic',
  detail: 'anthropic did not answer within 60000 ms',
  duration_ms: 60_000,
};
