import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Option, Result } from 'effect';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import type { InteractionFunctionDefinitionDocument, RequestDocument } from '../document/interaction-document.ts';

export const delivering: readonly string[] = [
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '{{ to }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
];

export const reading: readonly string[] = [
  'replies:',
  "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '    limit: 15',
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  '  wait: PT1M',
  '  tell:',
  '    with:',
  "      channel: '{{ sent.conversation }}'",
  "      thread_ts: '{{ sent.id }}'",
  "      text: '{{ message }}'",
];

export const answering: readonly string[] = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
];

export function documentOf(...frontMatter: readonly (readonly string[])[]): string {
  return ['---', ...frontMatter.flat(), '---', 'Approve {{ input.campaign }}?'].join('\n');
}

export function replacing(lines: readonly string[], line: string, replacement: string): readonly string[] {
  return lines.map((each) => (each === line ? replacement : each));
}

export function without(lines: readonly string[], ...left: readonly string[]): readonly string[] {
  return lines.filter((each) => !left.includes(each));
}

export function problemsOf(source: string): readonly string[] {
  const parsed = parseInteractionDocument(source, standingRenderClock);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}

function isRequest(document: InteractionFunctionDefinitionDocument): document is RequestDocument {
  return document.shape === 'request';
}

export function requestDocumentOf(source: string): RequestDocument {
  return Option.getOrThrow(
    Option.liftPredicate(Result.getOrThrow(parseInteractionDocument(source, standingRenderClock)), isRequest),
  );
}
