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

const decodeKinds = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ kind: Schema.String })));

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

function outrankedIn(database: ChatDatabase): ArrivalRows['outranked'] {
  return async ({ connection, account, conversation, message, kind }, over) => {
    const reopened = await database.write(statement`UPDATE chat_arrivals SET kind = ${kind}, state = 'taken'
      WHERE connection = ${connection} AND account = ${account} AND conversation = ${conversation}
        AND message = ${message} AND kind = ${over} AND state = 'passed' RETURNING message`);
    if (reopened.length === 1) {
      return 'taken';
    }
    const handed = await database.write(statement`UPDATE chat_arrivals SET kind = ${kind}
      WHERE connection = ${connection} AND account = ${account} AND conversation = ${conversation}
        AND message = ${message} AND kind = ${over} AND state = 'taken' RETURNING message`);
    return handed.length === 1 ? 'handed' : 'kept';
  };
}

export function storedArrivals(database: ChatDatabase): ArrivalRows {
  return {
    claimed: async ({ connection, account, conversation, message, kind }, at) => {
      const written = await database.write(statement`INSERT INTO chat_arrivals
          (connection, account, conversation, message, kind, state, arrived_at)
        VALUES (${connection}, ${account}, ${conversation}, ${message}, ${kind}, 'taken', ${at})
        ON CONFLICT (connection, account, conversation, message) DO NOTHING RETURNING message`);
      return written.length === 1;
    },
    outranked: outrankedIn(database),
    passed: async ({ connection, account, conversation, message, kind }) => {
      const passed = await database.write(statement`UPDATE chat_arrivals SET state = 'passed'
        WHERE connection = ${connection} AND account = ${account} AND conversation = ${conversation}
          AND message = ${message} AND kind = ${kind} AND state = 'taken' RETURNING message`);
      return passed.length === 1;
    },
    kindOf: async ({ connection, account, conversation, message }) =>
      decodeKinds(
        await database.read(statement`SELECT kind FROM chat_arrivals
          WHERE connection = ${connection} AND account = ${account} AND conversation = ${conversation}
            AND message = ${message}`),
      ).at(0)?.kind,
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
