import { toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { answerDocument } from '../bounds/tool-results.ts';
import type { CallReply } from '../calls/call-replies.ts';

export function executedAnswer({ scrubbedResult }: CallReply) {
  const document = scrubbedResult === undefined ? undefined : answerDocument(scrubbedResult);
  return document === undefined || bytesOf(JSON.stringify(document)) > toolBounds.executedAnswerBytes
    ? {}
    : { answer: document };
}
