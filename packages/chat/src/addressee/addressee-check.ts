import type { ModelRequest } from '@on.auto/reasoning';

import type { ChatModel, ConversationMessage } from '../model/chat-model.ts';
import { racedWith, type Waits } from '../turn/call-bounds.ts';

export const MOST_CHECKED_MESSAGES = 10;

export const MOST_CONTEXT_CHARACTERS = 1_000;

export const MOST_CHECK_OUTPUT_TOKENS = 2_048;

export const MOST_CHECK_MS = 15_000;

export const CHECK_REASONING = 'none';

export interface CheckBounds {
  readonly messages: number;
  readonly contextCharacters: number;
  readonly outputTokens: number;
  readonly ms: number;
}

export const CHECK_BOUNDS: CheckBounds = {
  messages: MOST_CHECKED_MESSAGES,
  contextCharacters: MOST_CONTEXT_CHARACTERS,
  outputTokens: MOST_CHECK_OUTPUT_TOKENS,
  ms: MOST_CHECK_MS,
};

export type Checked<Refused> = 'addressed' | 'unaddressed' | 'closed' | { readonly refused: Refused };

export interface CheckAsked<Refused> {
  readonly id: string;
  readonly model: ChatModel<Refused>;
  readonly instructions: string;
  readonly messages: readonly ConversationMessage[];
  readonly signal: Readonly<AbortSignal>;
  readonly waits: Waits;
  readonly bounds?: Partial<CheckBounds>;
}

const writerOf = (role: ConversationMessage['role']): string => (role === 'user' ? 'person' : 'auto');

export function checkInputOf(messages: readonly ConversationMessage[], bounds: CheckBounds = CHECK_BOUNDS): string {
  const reply = messages.at(-1);
  const context = messages.slice(0, -1).slice(1 - bounds.messages);
  return `${JSON.stringify({
    context: context.map(({ role, text }) => ({
      from: writerOf(role),
      text: text.slice(0, bounds.contextCharacters),
    })),
    reply: reply === undefined ? null : { from: writerOf(reply.role), text: reply.text },
  })}\n\nIs reply meant for Auto? Answer yes or no.`;
}

const requestOf = <Refused>(
  { id, model, instructions, messages }: CheckAsked<Refused>,
  bounds: CheckBounds,
): ModelRequest => ({
  model: model.name,
  instructions,
  output: { type: 'text' },
  settings: { max_output_tokens: bounds.outputTokens, reasoning: CHECK_REASONING },
  run_id: id,
  messages: [{ role: 'user', content: [{ type: 'text', text: checkInputOf(messages, bounds) }] }],
  timeout_ms: bounds.ms,
});

export const isYes = (text: string): boolean => text.trim().toLowerCase() === 'yes';

export async function addresseeChecked<Refused>(asked: CheckAsked<Refused>): Promise<Checked<Refused>> {
  const bounds: CheckBounds = { ...CHECK_BOUNDS, ...asked.bounds };
  const own = new AbortController();
  try {
    const raced = await racedWith(
      asked.model.generate(requestOf(asked, bounds), AbortSignal.any([asked.signal, own.signal])),
      bounds.ms,
      asked,
    );
    if ('stopped' in raced) {
      own.abort();
      return raced.stopped === 'closed' ? 'closed' : 'unaddressed';
    }
    const answer = raced.settled;
    if ('answered' in answer) {
      return isYes(answer.answered.text) ? 'addressed' : 'unaddressed';
    }
    return 'refused' in answer ? { refused: answer.refused } : 'unaddressed';
  } catch {
    return 'unaddressed';
  }
}
