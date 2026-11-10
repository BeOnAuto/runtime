import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { LastMessagesStore } from '../event-store.ts';
import { messageOfRow } from './recorded-messages.ts';
import { correlationOfMessage } from './sqlite-indexes.ts';
import { defaultPartition } from './sqlite-parts.ts';

const LastRows = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    id: Schema.String,
    metadata: Schema.fromJsonString(Schema.Unknown),
    correlation: Schema.NullOr(Schema.String),
    data: Schema.fromJsonString(Schema.Unknown),
  }),
);

export function sqliteLastMessages(execute: SQLExecutor): LastMessagesStore {
  return {
    lastMessageOf: async (stream) => {
      const { rows } = await execute.query(
        SQL`SELECT message_type AS type, message_id AS id, message_metadata AS metadata,
            ${correlationOfMessage} AS correlation, message_data AS data
          FROM emt_messages
          WHERE stream_id = ${stream} AND partition = ${defaultPartition} AND is_archived = FALSE
          ORDER BY stream_position DESC
          LIMIT 1`,
      );
      return Schema.decodeUnknownSync(LastRows)(rows)
        .map((row) => messageOfRow(row, row.data))
        .at(0);
    },
  };
}
