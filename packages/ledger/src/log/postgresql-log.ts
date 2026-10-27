import { Schema } from 'effect';

import type { RecordedPoint } from '../event-store.ts';
import {
  binding,
  defaultPartition,
  oldestWriteOfThisDatabase,
  writesOpenElsewhere,
  type Bind,
  type Query,
} from '../postgresql-reads/recorded-parts.ts';
import type { LoggedEvent, LogPorts } from './ledger-log.ts';

const LoggedRows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    stream: Schema.String,
    version: Schema.String,
    type: Schema.String,
    transaction: Schema.String,
    position: Schema.String,
  }),
);

const loggedColumns = `message_id AS id, stream_id AS stream, stream_position::text AS version,
  message_type AS type, transaction_id::text AS transaction, global_position::text AS position`;

function loggedIn(rows: readonly unknown[]): readonly LoggedEvent[] {
  return Schema.decodeUnknownSync(LoggedRows)(rows).map(({ id, stream, version, type, transaction, position }) => ({
    id,
    stream,
    version: Number(version),
    type,
    point: [transaction, position],
  }));
}

function pointAt(bind: Bind, point: RecordedPoint | undefined): string {
  const [transaction = '0', position = '0'] = point ?? [];
  return `(${bind(transaction)}::xid8, ${bind(position)}::bigint)`;
}

async function belowTheHorizon(query: Query, bind: Bind): Promise<string> {
  return `transaction_id < ${oldestWriteOfThisDatabase(bind, await writesOpenElsewhere(query))}
    AND partition = ${bind(defaultPartition)} AND is_archived = FALSE`;
}

export function postgresqlLogOn(query: Query): LogPorts {
  return {
    head: async () => {
      const { values, bind } = binding();
      const visible = await belowTheHorizon(query, bind);
      const rows = await query(
        `SELECT ${loggedColumns} FROM emt_messages WHERE ${visible}
          ORDER BY transaction_id DESC, global_position DESC LIMIT 1`,
        values,
      );
      return loggedIn(rows).at(0)?.point;
    },
    after: async (point, most) => {
      const { values, bind } = binding();
      const visible = await belowTheHorizon(query, bind);
      const rows = await query(
        `SELECT ${loggedColumns} FROM emt_messages
          WHERE (transaction_id, global_position) > ${pointAt(bind, point)} AND ${visible}
          ORDER BY transaction_id, global_position LIMIT ${bind(most + 1)}`,
        values,
      );
      const events = loggedIn(rows).slice(0, most);
      return { events, through: events.at(-1)?.point ?? point, more: rows.length > most };
    },
    at: async (point) => {
      const { values, bind } = binding();
      const rows = await query(
        `SELECT ${loggedColumns} FROM emt_messages
          WHERE (transaction_id, global_position) = ${pointAt(bind, point)}
            AND partition = ${bind(defaultPartition)} AND is_archived = FALSE`,
        values,
      );
      return loggedIn(rows).at(0);
    },
  };
}
