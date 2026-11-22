import type { Schema } from 'effect';

import type { ToolReply } from '../tools/directory-calls.ts';

export interface AskedCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
}

export interface AnsweredCall {
  readonly asked: AskedCall;
  readonly reply: ToolReply;
}

export interface Asked {
  readonly assistant: readonly Schema.JsonObject[];
  readonly said: string;
  readonly calls: readonly AskedCall[];
}

export interface TurnStep {
  readonly assistant: readonly Schema.JsonObject[];
  readonly said: string;
  readonly calls: readonly AnsweredCall[];
  readonly sent: number;
}

export const toolCallsSentIn = (steps: readonly TurnStep[]): number =>
  steps.reduce((sent, step) => sent + step.sent, 0);

function resultsMessage({ calls }: TurnStep): Schema.JsonObject {
  return {
    role: 'tool',
    content: calls.map(({ asked, reply }) => ({
      type: 'tool-result',
      toolCallId: asked.callId,
      toolName: asked.tool,
      output: { type: reply.isError ? 'error-text' : 'text', value: reply.text },
    })),
  };
}

export const conversationOf = (steps: readonly TurnStep[]): readonly Schema.JsonObject[] =>
  steps.flatMap((step) => [...step.assistant, resultsMessage(step)]);
