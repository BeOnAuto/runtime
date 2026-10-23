import { Effect, Schema } from 'effect';

import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { toolCallsResult, type ScriptedCall } from './model-results.ts';
import { answers, type ScriptedReply } from './scripted-language-model.ts';

export function callingTools(
  calls: readonly ScriptedCall[],
  then: ScriptedReply,
  asked: Partial<ModelResult> = {},
): readonly ScriptedReply[] {
  return [answers(toolCallsResult(calls, asked)), then];
}

const ToolAnswers = Schema.Struct({
  role: Schema.Literal('tool'),
  content: Schema.Array(Schema.Struct({ output: Schema.Struct({ value: Schema.String }) })),
});

const isToolAnswers = Schema.is(ToolAnswers);

function answersIn({ conversation = [] }: ModelRequest): readonly string[] {
  return conversation
    .filter((message) => isToolAnswers(message))
    .flatMap(({ content }) => content.map(({ output }) => output.value));
}

export function answeringFromTheTools(
  calls: readonly ScriptedCall[],
  answer: (texts: readonly string[]) => ModelResult,
): readonly ScriptedReply[] {
  return callingTools(calls, (request) => Effect.sync(() => answer(answersIn(request))));
}
