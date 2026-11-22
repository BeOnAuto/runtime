import { ambientTransactionSuppressed, type ChatDatabase } from './chat-database.ts';
import { chatLayoutKept } from './chat-layout.ts';
import type { ChatRows } from './chat-rows.ts';
import { arrivalsTable, arrivalsTables, storedArrivals } from './stored-arrivals.ts';
import { conversationsTable, conversationsTables, storedConversations } from './stored-conversations.ts';
import { linksTable, linksTables, linkStartsTable, storedLinks } from './stored-links.ts';
import { messagesTable, messagesTables, storedMessages } from './stored-messages.ts';

const chatDataTables: readonly string[] = [
  arrivalsTable,
  conversationsTable,
  messagesTable,
  linksTable,
  linkStartsTable,
];

const chatTables = [...arrivalsTables, ...conversationsTables, ...messagesTables, ...linksTables];

export async function chatRowsOpened(database: ChatDatabase): Promise<ChatRows> {
  const outsideAnyTransaction = ambientTransactionSuppressed(database);
  await chatLayoutKept(outsideAnyTransaction, chatDataTables);
  await outsideAnyTransaction.migrated(chatTables);
  return {
    arrivals: storedArrivals(outsideAnyTransaction),
    conversations: storedConversations(outsideAnyTransaction),
    messages: storedMessages(outsideAnyTransaction),
    links: storedLinks(outsideAnyTransaction),
  };
}
