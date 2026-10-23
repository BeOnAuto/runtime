export function anthropicMessage(text: string, model = 'claude-sonnet-4-5-20250929'): object {
  return {
    id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 25, output_tokens: 9, cache_creation_input_tokens: 4, cache_read_input_tokens: 11 },
  };
}

export function anthropicToolAnswer(input: object): object {
  return {
    id: 'msg_01Tool',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-haiku-20240307',
    content: [{ type: 'tool_use', id: 'toolu_01', name: 'json', input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 30, output_tokens: 12 },
  };
}

export function openAiResponse(text: string): object {
  return {
    id: 'resp_67ccd2bed1ec8190b14f964abc054267',
    object: 'response',
    created_at: 1_741_476_542,
    status: 'completed',
    model: 'gpt-5-2025-08-07',
    output: [
      {
        type: 'message',
        id: 'msg_67ccd2bf17f0819081ff3bb2cf6508e6',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    incomplete_details: null,
    usage: {
      input_tokens: 36,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 87,
      output_tokens_details: { reasoning_tokens: 64 },
      total_tokens: 123,
    },
  };
}

export function chatCompletion(text: string, finishReason = 'stop'): object {
  return {
    id: 'chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT',
    object: 'chat.completion',
    created: 1_741_569_952,
    model: 'llama-3.3-70b',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 19,
      completion_tokens: 10,
      total_tokens: 29,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

export function geminiContent(text: string): object {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: {
      promptTokenCount: 14,
      candidatesTokenCount: 6,
      totalTokenCount: 28,
      cachedContentTokenCount: 5,
      thoughtsTokenCount: 8,
    },
    modelVersion: 'gemini-2.5-flash',
    responseId: 'gemini-response-1',
  };
}

export function converseMessage(text: string): object {
  return {
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
    usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25, cacheReadInputTokens: 6, cacheWriteInputTokens: 2 },
    metrics: { latencyMs: 412 },
  };
}

export function converseToolAnswer(input: object): object {
  return {
    output: {
      message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'tooluse_1', name: 'json', input } }] },
    },
    stopReason: 'tool_use',
    usage: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
    metrics: { latencyMs: 380 },
  };
}
