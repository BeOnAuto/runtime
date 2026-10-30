import { capitalized, quoted } from '@on.auto/operations';

import { toolBounds } from '../bounds/call-bounds.ts';
import { serverFailedText } from '../calls/call-replies.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { toolInWords } from '../names/tool-words.ts';
import type { CalledOutcome } from './execute-schemas.ts';

export interface CallAnswer extends ToolReference {
  readonly outcome: CalledOutcome;
  readonly text: string;
  readonly result_bytes: number | null;
  readonly duration_ms: number;
}

const measured = new Intl.NumberFormat('en');

export const executeTask = 'call a tool of a tool server';

export function executeAttempted(asked: ToolReference): string {
  return `call ${toolInWords(asked)}`;
}

function bytesInWords(bytes: number | null): string {
  return bytes === null ? 'nothing' : `${measured.format(bytes)} bytes`;
}

function failureOf({ server, text }: CallAnswer): string {
  return text.replace(serverFailedText(server, ''), '').replace(/\.$/u, '');
}

const wordsOf: Readonly<Record<CalledOutcome, (answer: CallAnswer) => string>> = {
  result: (answer) =>
    `${capitalized(toolInWords(answer))} answered in ${measured.format(answer.duration_ms)} ms with ${bytesInWords(answer.result_bytes)}; what a reasoning function's model would see is in the details.`,
  tool_error: (answer) =>
    `${capitalized(toolInWords(answer))} answered an error, as a run's model would see it; the details show what it said.`,
  server_failure: (answer) =>
    `The tool server ${quoted(answer.server)} failed to answer the call: ${failureOf(answer)}. It may or may not have received the call.`,
  timed_out: (answer) =>
    `The tool server ${quoted(answer.server)} did not answer the call within ${measured.format(toolBounds.callMs / 1000)} seconds; it may still have received it.`,
  too_large: (answer) =>
    `${capitalized(toolInWords(answer))} answered more than one call may take, so its answer was not read; ask it for less, a page at a time.`,
};

export function executed(answer: CallAnswer): string {
  return wordsOf[answer.outcome](answer);
}
