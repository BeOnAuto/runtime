import type { KeptSecrets } from '@on.auto/openid-connect/authorization-server';

import type { ChatRows, KeyedConversation, MemberOfAnAccount } from '../tables/chat-rows.ts';

interface ConnectionRemoved {
  readonly connection: string;
  readonly account: string;
}

export interface ConversationAsked {
  readonly account: string;
  readonly conversation: string;
  readonly thread?: string | undefined;
}

export interface ChatDeletions {
  readonly connectionRemoved: (removed: ConnectionRemoved) => Promise<void>;
  readonly disconnected: (member: MemberOfAnAccount) => Promise<void>;
  readonly conversationDeleted: (asked: ConversationAsked) => Promise<boolean>;
  readonly memberDeleted: (member: MemberOfAnAccount) => Promise<boolean>;
}

async function wholeDeleted(rows: ChatRows, keys: KeptSecrets, conversations: readonly KeyedConversation[]) {
  await conversations.reduce(async (before: Promise<void>, { keyId }) => {
    await before;
    await keys.forget(keyId);
  }, Promise.resolve());
  await rows.conversations.deleted(conversations.map(({ id }) => id));
}

export function chatDeletionsOver(rows: ChatRows, keys: KeptSecrets): ChatDeletions {
  return {
    connectionRemoved: async ({ connection, account }) => {
      await wholeDeleted(rows, keys, await rows.conversations.selected({ connection }));
      await rows.arrivals.deleted({ connection });
      await rows.links.linksDeleted({ account });
      await rows.links.startsDeleted({ account });
    },
    disconnected: async (member) => {
      await rows.links.linksDeleted(member);
    },
    conversationDeleted: async ({ account, conversation, thread }) => {
      const kept = await rows.conversations.selected({ account, conversation, thread });
      await wholeDeleted(rows, keys, kept);
      const arrivalsDeleted = thread === undefined && (await rows.arrivals.deleted({ account, conversation }));
      return kept.length > 0 || arrivalsDeleted;
    },
    memberDeleted: async (member) => {
      const writtenIn = await rows.conversations.writtenIn(member);
      const [linked, started] = await Promise.all([rows.links.linksDeleted(member), rows.links.startsDeleted(member)]);
      await wholeDeleted(
        rows,
        keys,
        writtenIn.filter(({ senders }) => senders.every((sender) => sender === member.member)),
      );
      await rows.messages.senderDeleted(member);
      return writtenIn.length > 0 || linked || started;
    },
  };
}
