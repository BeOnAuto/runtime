import { chatStoreOpened, type ChatStore } from '../chat/store/chat-store.ts';
import { ledgerStoresOpenedBy } from '../database/ledger-stores.ts';
import { servedBy } from '../server-options/server-options.ts';
import { keptSecretsOf } from '../sign-in/issued-tokens.ts';
import {
  chatConversationDeleted,
  chatDeletionAsked,
  chatTablesNotOpened,
  ledgerRead,
  memberChatDeleted,
  noChatConversation,
  noChatOfMember,
  out,
  refused,
  type ChatConversationNamed,
  type ChatMemberNamed,
  type Said,
} from './admin-words.ts';
import type { Opened, OpeningOf } from './opened-for-a-command.ts';

type ChatOpening = Pick<Opened, 'settings' | 'runtime' | 'database' | 'connection'>;

type Asked = ChatMemberNamed | ChatConversationNamed;

function askedIn([what, account, id, thread]: readonly string[]): Asked | undefined {
  if (account === undefined || id === undefined) {
    return undefined;
  }
  if (what === 'conversation') {
    return { account, conversation: id, thread };
  }
  return what === 'member' && thread === undefined ? { account, member: id } : undefined;
}

function messageOf(failure: unknown): string {
  return String(Reflect.get(new Object(failure), 'message'));
}

export async function withTheChatOpened(
  { settings, runtime, database, connection }: ChatOpening,
  use: (chat: ChatStore) => Promise<Said>,
): Promise<Said> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
  try {
    const chat = await chatStoreOpened(connection, keptSecretsOf(stores.secrets)).catch((failure: unknown) =>
      refused(chatTablesNotOpened(messageOf(failure))),
    );
    return 'said' in chat ? chat : await use(chat);
  } finally {
    await stores.withSecretsClosed(servedBy([])).stopWork();
  }
}

async function deletedFrom(chat: ChatStore, asked: Asked, opening: ChatOpening): Promise<Said> {
  const read = ledgerRead(opening.settings.ledger);
  if ('member' in asked) {
    return (await chat.deletions.memberDeleted(asked))
      ? out(memberChatDeleted(asked))
      : out(noChatOfMember(asked), read);
  }
  return (await chat.deletions.conversationDeleted(asked))
    ? out(chatConversationDeleted(asked))
    : out(noChatConversation(asked), read);
}

export function chatDeletedBy(given: readonly string[], open: OpeningOf<ChatOpening>): Promise<Said> {
  const asked = askedIn(given);
  return asked === undefined
    ? Promise.resolve(refused(chatDeletionAsked))
    : open((opening) => withTheChatOpened(opening, (chat) => deletedFrom(chat, asked, opening)));
}
