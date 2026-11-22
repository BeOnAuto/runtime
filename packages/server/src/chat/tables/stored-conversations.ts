import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import { chunksOf, oneOf, type ChatDatabase } from './chat-database.ts';
import type {
  ConversationRow,
  ConversationRows,
  ConversationsSelected,
  KeyedConversation,
  WrittenIn,
} from './chat-rows.ts';

export const conversationsTable = 'chat_conversations';

export const conversationsTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT NOT NULL PRIMARY KEY,
    connection TEXT NOT NULL,
    account TEXT NOT NULL,
    conversation TEXT NOT NULL,
    thread TEXT NOT NULL,
    key_id TEXT NOT NULL,
    lease_holder TEXT,
    leased_until BIGINT,
    started_at BIGINT NOT NULL,
    UNIQUE (connection, account, conversation, thread)
  )`,
];

const noThread = '';

const threadOf = (thread: string | undefined): string => thread ?? noThread;

const KeyedSchema = Schema.Struct({ id: Schema.String, key_id: Schema.String });

const decodeKeyed = Schema.decodeUnknownSync(Schema.Array(KeyedSchema));

const decodeSenders = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ id: Schema.String, key_id: Schema.String, sender: Schema.String })),
);

const keyedOf = ({ id, key_id: keyId }: typeof KeyedSchema.Type): KeyedConversation => ({ id, keyId });

function selectedBy(selected: ConversationsSelected): Statement {
  if ('connection' in selected) {
    return statement`SELECT id, key_id FROM chat_conversations WHERE connection = ${selected.connection} ORDER BY id`;
  }
  const { account, conversation, thread } = selected;
  return thread === undefined
    ? statement`SELECT id, key_id FROM chat_conversations
        WHERE account = ${account} AND conversation = ${conversation} ORDER BY id`
    : statement`SELECT id, key_id FROM chat_conversations
        WHERE account = ${account} AND conversation = ${conversation} AND thread = ${thread} ORDER BY id`;
}

interface Grouped {
  readonly id: string;
  readonly keyId: string;
  readonly senders: string[];
}

function sendersGrouped(rows: ReturnType<typeof decodeSenders>): readonly WrittenIn[] {
  const grouped: Grouped[] = [];
  for (const { id, key_id: keyId, sender } of rows) {
    const last = grouped.at(-1);
    if (last?.id === id) {
      last.senders.push(sender);
    } else {
      grouped.push({ id, keyId, senders: [sender] });
    }
  }
  return grouped;
}

function deletedIn(ids: readonly [string, ...string[]]): readonly Statement[] {
  return [
    oneOf('UPDATE chat_conversations SET lease_holder = lease_holder WHERE id', ids),
    oneOf('DELETE FROM chat_messages WHERE conversation_id', ids),
    oneOf('DELETE FROM chat_conversations WHERE id', ids),
  ];
}

export function storedConversations(database: ChatDatabase): ConversationRows {
  return {
    found: async (place) => {
      const [row] = decodeKeyed(
        await database.read(statement`SELECT id, key_id FROM chat_conversations
          WHERE connection = ${place.connection} AND account = ${place.account}
            AND conversation = ${place.conversation} AND thread = ${threadOf(place.thread)}`),
      );
      return row === undefined ? undefined : ({ ...place, ...keyedOf(row) } satisfies ConversationRow);
    },
    made: async ({ id, connection, account, conversation, thread, keyId }, at) => {
      const written = await database.write(statement`INSERT INTO chat_conversations
          (id, connection, account, conversation, thread, key_id, started_at)
        VALUES (${id}, ${connection}, ${account}, ${conversation}, ${threadOf(thread)}, ${keyId}, ${at})
        ON CONFLICT (connection, account, conversation, thread) DO NOTHING RETURNING id`);
      return written.length === 1;
    },
    leaseTaken: async (id, { holder, now, until }) => {
      const written = await database.write(statement`UPDATE chat_conversations
        SET lease_holder = ${holder}, leased_until = ${until}
        WHERE id = ${id} AND (lease_holder IS NULL OR leased_until <= ${now}) RETURNING id`);
      return written.length === 1;
    },
    leaseReleased: async (id, holder) => {
      await database.write(statement`UPDATE chat_conversations SET lease_holder = NULL, leased_until = NULL
        WHERE id = ${id} AND lease_holder = ${holder}`);
    },
    selected: async (selected) => decodeKeyed(await database.read(selectedBy(selected))).map((row) => keyedOf(row)),
    writtenIn: async ({ account, member }) =>
      sendersGrouped(
        decodeSenders(
          await database.read(statement`SELECT DISTINCT c.id, c.key_id, m.sender
            FROM chat_conversations c JOIN chat_messages m ON m.conversation_id = c.id
            WHERE c.account = ${account} AND m.sender IS NOT NULL
              AND c.id IN (SELECT conversation_id FROM chat_messages WHERE sender = ${member})
            ORDER BY c.id, m.sender`),
        ),
      ),
    deleted: async (ids) => {
      const statements = chunksOf(ids, database.mostBoundValues).flatMap((chunk) => deletedIn(chunk));
      if (statements.length > 0) {
        await database.transaction(statements);
      }
    },
  };
}
