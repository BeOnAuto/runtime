import type { MemoryRows, Remembered } from '@on.auto/chat';
import type { KeptSecrets } from '@on.auto/openid-connect/authorization-server';
import { Data } from 'effect';

import type { ChatClock } from '../tables/chat-database.ts';
import type { ChatRows, ConversationRow, SealedRow } from '../tables/chat-rows.ts';
import { keyOnceOf } from './conversation-key.ts';
import { openedFor, sealedFor, type RowBinding } from './sealed-texts.ts';

export class ConversationLeaseLost extends Data.TaggedError('conversation_lease_lost')<{
  readonly conversation: string;
  readonly message: string;
}> {}

export interface LeasedConversation {
  readonly memory: MemoryRows;
  readonly released: () => Promise<void>;
}

export interface Leasing {
  readonly rows: ChatRows;
  readonly keys: KeptSecrets;
  readonly now: ChatClock;
}

const messageOf = (conversation: string, { sequence, author, sender }: Omit<SealedRow, 'sealed'>): RowBinding => [
  'chat_messages',
  conversation,
  sequence,
  author,
  sender ?? null,
];

function leaseLost(conversation: string): ConversationLeaseLost {
  return new ConversationLeaseLost({
    conversation,
    message: `The conversation ${conversation} is no longer leased to this turn, so nothing of it was kept`,
  });
}

export function leasedMemoryOf(
  { rows, keys, now }: Leasing,
  conversation: ConversationRow,
  holder: string,
): MemoryRows {
  const key = keyOnceOf(keys, conversation);
  return {
    newest: async (most) => {
      const sealed = await rows.messages.newest(conversation.id, most);
      if (sealed.length === 0) {
        return [];
      }
      const opened = await key();
      return sealed.map(({ sequence, author, sender, sealed: text }) => ({
        sequence,
        author,
        sender,
        text: openedFor(opened, messageOf(conversation.id, { sequence, author, sender }), text),
      }));
    },
    appended: async (remembered) => {
      const [first, ...rest] = remembered;
      if (first === undefined) {
        return;
      }
      const [opened, last, at] = await Promise.all([key(), rows.messages.last(conversation.id), now()]);
      const sealedOf = ({ author, sender, text }: Remembered, offset: number): SealedRow => {
        const row = { sequence: last + offset + 1, author, sender };
        return { ...row, sealed: sealedFor(opened, messageOf(conversation.id, row), text) };
      };
      const sealed: readonly [SealedRow, ...SealedRow[]] = [
        sealedOf(first, 0),
        ...rest.map((each, index) => sealedOf(each, index + 1)),
      ];
      if (!(await rows.messages.appended(conversation.id, holder, sealed, at))) {
        throw leaseLost(conversation.id);
      }
    },
  };
}
