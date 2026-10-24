import type { RecordedCall } from '@on.auto/definitions';
import { keptReply } from '@on.auto/tool-servers/policy';
import { Effect, Option } from 'effect';

import type { KeptContent } from './kept-content.ts';
import { promptIn, responseOf, stepMessagesOf, type Prompt } from './step-messages.ts';
import { evolve, type StepContent, type StepState } from './step-state.ts';

function keptAs(
  kept: KeptContent | undefined,
  sha256: string | undefined,
  read: (text: string) => StepContent,
): Effect.Effect<StepContent> {
  return kept === undefined || sha256 === undefined
    ? Effect.succeed({})
    : Effect.map(kept.read(sha256), (text) => (text === undefined ? {} : read(text)));
}

function contentOf(kept: KeptContent | undefined, call: RecordedCall): Effect.Effect<StepContent> {
  if (call.type === 'model_call_started') {
    return keptAs(kept, call.data.messages_sha256, (text) => ({ sent: stepMessagesOf(text) }));
  }
  if (call.type === 'model_call_answered') {
    return keptAs(kept, call.data.response_sha256, (text) => ({ response: responseOf(text) }));
  }
  return call.type === 'tool_call_answered'
    ? keptAs(kept, call.data.result_sha256, (text) => ({ reply: keptReply(call.data, text) }))
    : Effect.succeed({});
}

export type ModelCallStart = Extract<RecordedCall, { readonly type: 'model_call_started' }>;

function isModelCallStart(call: RecordedCall): call is ModelCallStart {
  return call.type === 'model_call_started';
}

export function firstModelCallOf(calls: readonly RecordedCall[]): ModelCallStart | undefined {
  return calls.find((call) => isModelCallStart(call));
}

export function keptPromptOf(kept: KeptContent, { data }: ModelCallStart): Effect.Effect<Prompt | undefined> {
  const sha256 = data.messages_sha256;
  return sha256 === undefined
    ? Effect.undefined
    : Effect.map(kept.read(sha256), (text) => (text === undefined ? undefined : Option.getOrUndefined(promptIn(text))));
}

export function resumedState(
  kept: KeptContent | undefined,
  from: StepState,
  calls: readonly RecordedCall[],
): Effect.Effect<StepState> {
  return Effect.reduce(
    calls,
    () => from,
    (state, call) => Effect.map(contentOf(kept, call), (content) => evolve(state, call, content)),
  );
}
