import { Schema } from 'effect';

import type { LastMessagesStore } from '../event-store.ts';
import { dataAsJsonText } from '../postgresql/json-text.ts';
import { messageOfRow } from '../recorded/recorded-messages.ts';
import { binding, defaultPartition, lineageColumns, type Query } from './recorded-parts.ts';

const LastRows = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    id: Schema.String,
    metadata: Schema.Unknown,
    correlation: Schema.NullOr(Schema.String),
    data: Schema.Struct({ json: Schema.String }),
  }),
);

export function postgresqlLastMessages(query: Query): LastMessagesStore {
  return {
    lastMessageOf: async (stream) => {
      const { values, bind } = binding();
      const rows = await query(
        `SELECT message_type AS type, ${lineageColumns}, message_data AS data
          FROM emt_messages
          WHERE stream_id = ${bind(stream)} AND partition = ${bind(defaultPartition)} AND is_archived = FALSE
          ORDER BY stream_position DESC
          LIMIT 1`,
        values,
      );
      return Schema.decodeUnknownSync(LastRows)(rows)
        .map((row) => messageOfRow(row, dataAsJsonText.read(row.data)))
        .at(0);
    },
  };
}
