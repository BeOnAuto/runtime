import { threadDocument, threadReplies } from './documents.ts';

export const flatReplies: readonly string[] = [
  'replies:',
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text }',
  '  tell:',
  '    with:',
  "      channel: '{{ sent.conversation }}'",
  "      text: '{{ message }}'",
];

export const newestFirstReplies: readonly string[] = [
  'replies:',
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  '  read:',
  '    list: /messages',
  '    order: newest_first',
  '    each: { id: /ts, sender: /user, text: /text }',
];

export function threadRepliesWith(line: string, replacement: string): string {
  return threadDocument({ replies: threadReplies.map((each) => (each === line ? replacement : each)) });
}
