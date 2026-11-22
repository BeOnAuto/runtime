import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import { WholeNumber, type ChatDatabase } from './chat-database.ts';
import type { MessageRows, SealedRow } from './chat-rows.ts';

export const messagesTable = 'chat_messages';

export const messagesTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS chat_messages (
    conversation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    author TEXT NOT NULL,
    sender TEXT,
    text_sealed TEXT NOT NULL,
    written_at BIGINT NOT NULL,
    PRIMARY KEY (conversation_id, sequence)
  )`,
  statement`CREATE INDEX IF NOT EXISTS chat_messages_by_sender ON chat_messages (sender)`,
];

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      sequence: WholeNumber,
      author: Schema.Literals(['person', 'assistant', 'context', 'overheard']),
      sender: Schema.NullOr(Schema.String),
      text_sealed: Schema.String,
    }),
  ),
);

const decodeLast = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ last: Schema.NullOr(WholeNumber) })]));

function appendedIn(conversation: string, holder: string, at: number, row: SealedRow): Statement {
  const { sequence, author, sender = null, sealed } = row;
  return statement`INSERT INTO chat_messages (conversation_id, sequence, author, sender, text_sealed, written_at)
    SELECT id, CAST(${sequence} AS INTEGER), ${author}, ${sender}, ${sealed}, CAST(${at} AS BIGINT)
    FROM chat_conversations WHERE id = ${conversation} AND lease_holder = ${holder}
    RETURNING sequence`;
}

export function storedMessages(database: ChatDatabase): MessageRows {
  return {
    newest: async (conversation, most) => {
      const rows = decodeRows(
        await database.read(statement`SELECT sequence, author, sender, text_sealed FROM chat_messages
          WHERE conversation_id = ${conversation} ORDER BY sequence DESC LIMIT ${most}`),
      );
      return rows.toReversed().map(({ sequence, author, sender, text_sealed: sealed }) => ({
        sequence,
        author,
        sender: sender ?? undefined,
        sealed,
      }));
    },
    last: async (conversation) => {
      const [{ last }] = decodeLast(
        await database.read(
          statement`SELECT MAX(sequence) AS last FROM chat_messages WHERE conversation_id = ${conversation}`,
        ),
      );
      return last ?? 0;
    },
    appended: async (conversation, holder, rows, at) => {
      const held = statement`UPDATE chat_conversations SET lease_holder = lease_holder
        WHERE id = ${conversation} AND lease_holder = ${holder}`;
      const written = await database.transaction([
        held,
        ...rows.map((row) => appendedIn(conversation, holder, at, row)),
      ]);
      return written.length === 1;
    },
    senderDeleted: async ({ account, member }) => {
      await database.write(statement`DELETE FROM chat_messages WHERE sender = ${member}
        AND conversation_id IN (SELECT id FROM chat_conversations WHERE account = ${account})`);
    },
  };
}
