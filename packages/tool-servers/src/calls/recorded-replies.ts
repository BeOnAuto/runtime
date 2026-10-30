import { shownAgain } from '../bounds/call-bounds.ts';
import { answerOf, resultText } from '../bounds/tool-results.ts';
import type { CallAnswered, CallFailed } from './call-facts.ts';
import { serverFailedText, type ToolReply } from './call-replies.ts';

const saidAsItIs: ReadonlySet<CallFailed['because']> = new Set(['arguments_refused', 'too_large']);

export function keptReply({ is_error: isError, shown_bytes: shownBytes }: CallAnswered, kept: string): ToolReply {
  const text = resultText(answerOf(kept));
  return { text: shownBytes === undefined ? text : shownAgain(text, shownBytes), isError };
}

export function failureReply({ because, detail = '' }: CallFailed, server: string): ToolReply {
  return { text: saidAsItIs.has(because) ? detail : serverFailedText(server, detail), isError: true };
}
