import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { ChatDatabase } from './chat-database.ts';
import type { ArrivalRows } from './chat-rows.ts';

export const arrivalsTable = 'chat_arrivals';

export const arrivalsTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS chat_arrivals (
    connection TEXT NOT NULL,
    account TEXT NOT NULL,
    conversation TEXT NOT NULL,
    message TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    arrived_at BIGINT NOT NULL,
    PRIMARY KEY (connection, account, conversation, message)
  )`,
  statement`CREATE INDEX IF NOT EXISTS chat_arrivals_taken ON chat_arrivals (arrived_at) WHERE state = 'taken'`,
];

const decodeArrivals = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      connection: Schema.String,
      account: Schema.String,
      conversation: Schema.String,
      message: Schema.String,
      kind: Schema.String,
    }),
  ),
);

export function storedArrivals(database: ChatDatabase): ArrivalRows {
  return {
    claimed: async ({ connection, account, conversation, message, kind }, at) => {
      const written = await database.write(statement`INSERT INTO chat_arrivals
          (connection, account, conversation, message, kind, state, arrived_at)
        VALUES (${connection}, ${account}, ${conversation}, ${message}, ${kind}, 'taken', ${at})
        ON CONFLICT (connection, account, conversation, message) DO NOTHING RETURNING message`);
      return written.length === 1;
    },
    settled: async ({ connection, account, conversation, message }) => {
      await database.write(statement`UPDATE chat_arrivals SET state = 'settled'
        WHERE connection = ${connection} AND account = ${account} AND conversation = ${conversation}
          AND message = ${message} AND state = 'taken'`);
    },
    unsettled: async () =>
      decodeArrivals(
        await database.read(statement`SELECT connection, account, conversation, message, kind FROM chat_arrivals
          WHERE state = 'taken' ORDER BY arrived_at, connection, account, conversation, message`),
      ),
    deleted: async (selected) => {
      const deleted = await database.write(
        'connection' in selected
          ? statement`DELETE FROM chat_arrivals WHERE connection = ${selected.connection} RETURNING message`
          : statement`DELETE FROM chat_arrivals
              WHERE account = ${selected.account} AND conversation = ${selected.conversation} RETURNING message`,
      );
      return deleted.length > 0;
    },
  };
}
