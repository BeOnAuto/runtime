import { shownAgain } from '../bounds/call-bounds.ts';
import { answerOf, resultText } from '../bounds/tool-results.ts';
import type { CallAnswered, CallFailed } from './call-facts.ts';
import { serverFailedText, type ToolReply } from './call-replies.ts';
import { textShownInFormatOne } from './shown-format-one.ts';

const saidAsItIs: ReadonlySet<CallFailed['because']> = new Set(['arguments_refused', 'too_large']);

function textShownOf({ shown_format: format }: CallAnswered, kept: string): string {
  return format === undefined ? textShownInFormatOne(kept) : resultText(answerOf(kept));
}

export function keptReply(answered: CallAnswered, kept: string): ToolReply {
  const { is_error: isError, shown_bytes: shownBytes } = answered;
  const text = textShownOf(answered, kept);
  return { text: shownBytes === undefined ? text : shownAgain(text, shownBytes), isError };
}

export function failureReply({ because, detail = '' }: CallFailed, server: string): ToolReply {
  return { text: saidAsItIs.has(because) ? detail : serverFailedText(server, detail), isError: true };
}
