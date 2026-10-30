import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';

import { alpha } from '../servers/reasoning-server.ts';
import type { InteractionServer } from './interaction-server.ts';

const readingOf = (conversation: readonly string[], to: readonly string[]): readonly string[] => [
  'replies:',
  ...conversation,
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  ...to,
  `    oldest: '{{ since | default: "0" }}'`,
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  `    each: { id: /ts, sender: /user, text: /text${to.length === 0 ? '' : ', to: /thread_ts'} }`,
];

export const threadReading: readonly string[] = readingOf(
  ["  conversation: '{{ sent.conversation }}/{{ sent.id }}'"],
  ["    ts: '{{ sent.id }}'"],
);

export const toldReading: readonly string[] = [
  ...threadReading,
  '  tell:',
  '    with:',
  "      channel: '{{ sent.conversation }}'",
  "      thread_ts: '{{ sent.id }}'",
  "      text: '{{ message }}'",
];

export const flatReading: readonly string[] = readingOf([], []);

const ListedSchema = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      function: Schema.String,
      conversation: Schema.NullOr(Schema.String),
      answerer: Schema.NullOr(Schema.String),
      reply_refusals: Schema.Int,
    }),
  ),
});

const decodeListed = Schema.decodeUnknownSync(ListedSchema);

export type ListedInteraction = (typeof ListedSchema.Type)['interactions'][number];

export async function interactionsOf(server: InteractionServer): Promise<readonly ListedInteraction[]> {
  return decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions;
}

export function readingIn(count: number): (listed: readonly ListedInteraction[]) => boolean {
  return (listed) => listed.length >= count && listed.every(({ conversation }) => conversation !== null);
}

export async function playbookEventsOf(server: InteractionServer): Promise<string> {
  return JSON.stringify((await server.call('GET', `${alpha}/events`)).body);
}

export function readRecorded(events: string): boolean {
  return events.includes('replies_read');
}

export function readAndTold(events: string): boolean {
  return readRecorded(events) && /telling_(?:succeeded|failed)/u.test(events);
}

export function readsOf(chat: Pick<FakeMcpServer, 'received'>): Promise<readonly unknown[]> {
  return Promise.resolve(chat.received().filter(({ tool }) => tool === 'thread_replies'));
}

export function someRead(reads: readonly unknown[]): boolean {
  return reads.length > 0;
}
