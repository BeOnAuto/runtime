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

const namingTheirMessage = '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }';

const namingNoMessage = '    each: { id: /ts, sender: /user, text: /text }';

export const flatNamingReplies: readonly string[] = flatReplies.map((line) =>
  line === namingNoMessage ? namingTheirMessage : line,
);

export const threadOfTheChannelReplies: readonly string[] = threadReplies.filter(
  (line) => !line.startsWith('  conversation:'),
);

export const threadNamingNoMessageReplies: readonly string[] = threadOfTheChannelReplies.map((line) =>
  line === namingTheirMessage ? namingNoMessage : line,
);

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
  '  tell: none',
];

export function threadRepliesWith(line: string, replacement: string): string {
  return threadDocument({ replies: threadReplies.map((each) => (each === line ? replacement : each)) });
}
