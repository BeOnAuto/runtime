export function anthropicToolCall(name: string, input: unknown): object {
  return {
    id: 'msg_01ToolCall',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: [{ type: 'tool_use', id: 'toolu_call_1', name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 30, output_tokens: 12 },
  };
}

export function openAiFunctionCall(name: string, input: unknown): object {
  return {
    id: 'resp_function_call',
    object: 'response',
    created_at: 1_741_476_542,
    status: 'completed',
    model: 'gpt-5-2025-08-07',
    output: [
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name,
        arguments: JSON.stringify(input),
        status: 'completed',
      },
    ],
    incomplete_details: null,
    usage: { input_tokens: 30, output_tokens: 12, total_tokens: 42 },
  };
}

export function chatCompletionToolCall(name: string, input: unknown): object {
  return {
    id: 'chatcmpl-tool-call',
    object: 'chat.completion',
    created: 1_741_569_952,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(input) } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
  };
}

export function geminiFunctionCall(name: string, input: unknown): object {
  return {
    candidates: [
      { content: { role: 'model', parts: [{ functionCall: { name, args: input } }] }, finishReason: 'STOP', index: 0 },
    ],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 },
    modelVersion: 'gemini-2.5-flash',
    responseId: 'gemini-function-call',
  };
}

export function converseToolCall(name: string, input: unknown): object {
  return {
    output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'tooluse_call_1', name, input } }] } },
    stopReason: 'tool_use',
    usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
    metrics: { latencyMs: 380 },
  };
}
