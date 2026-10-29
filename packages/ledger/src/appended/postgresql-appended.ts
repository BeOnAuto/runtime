import { Schema } from 'effect';

import type {
  AppendListeners,
  AppendWaitsStore,
  LatestAppends,
  ReadLatestAppends,
  RecordedPoint,
  RecordedStore,
  StreamAgesStore,
} from '../event-store.ts';
import { kindKeyOfStream } from '../postgresql-reads/playbook-indexes.ts';
import {
  binding,
  defaultPartition,
  oldestWriteOfThisDatabase,
  writesOpenElsewhere,
  type Query,
} from '../postgresql-reads/recorded-parts.ts';
import { postgresqlStreamAges } from '../stream-ages/postgresql-stream-ages.ts';
import { appendWatchOf } from './append-watch.ts';

const AppendedRows = Schema.NonEmptyArray(
  Schema.Union([
    Schema.Struct({
      horizon: Schema.String,
      name: Schema.String,
      read: Schema.Int,
      transaction: Schema.String,
      position: Schema.String,
    }),
    Schema.Struct({ horizon: Schema.String, name: Schema.Null }),
  ]),
);

type AppendedRow = (typeof AppendedRows.Type)[number];

interface Group {
  readonly name: string;
  readonly read: number;
  readonly transaction: bigint;
  readonly position: bigint;
}

function laterOf(left: Group, right: Group): Group {
  const later =
    left.transaction === right.transaction ? left.position > right.position : left.transaction > right.transaction;
  return later ? left : right;
}

function groupsOf(rows: readonly AppendedRow[]): readonly Group[] {
  return rows.flatMap((row) =>
    row.name === null
      ? []
      : [{ name: row.name, read: row.read, transaction: BigInt(row.transaction), position: BigInt(row.position) }],
  );
}

function pointOf({ transaction, position }: Group): RecordedPoint {
  return [String(transaction), String(position)];
}

function appendedOf(horizon: string, groups: readonly Group[], most: number): LatestAppends {
  const read = groups.reduce((sum, group) => sum + group.read, 0);
  const streams = groups.map(({ name }) => name);
  const latest = new Map(groups.map((group) => [group.name, pointOf(group)]));
  const [first, ...others] = groups;
  if (first === undefined || read < most) {
    return { streams, latest, through: [horizon, '0'], more: false };
  }
  const last = others.reduce((later, group) => laterOf(later, group), first);
  return { streams, latest, through: pointOf(last), more: true };
}

export function postgresqlAppended(
  query: Query,
  listeners: AppendListeners = {},
): Pick<RecordedStore, 'readAppended'> & StreamAgesStore & AppendWaitsStore {
  const readAppended = appendedAfter(query);
  return { readAppended, ...appendWatchOf(readAppended, listeners), ...postgresqlStreamAges(query) };
}

function appendedAfter(query: Query): ReadLatestAppends {
  return async (after, most) => {
    const elsewhere = await writesOpenElsewhere(query);
    const { values, bind } = binding();
    const [transaction = '0', position = '0'] = after ?? [];
    const rows = await query(
      `WITH horizon AS MATERIALIZED (SELECT ${oldestWriteOfThisDatabase(bind, elsewhere)} AS below),
      appended AS (
        SELECT transaction_id, global_position, coalesce(${kindKeyOfStream}, stream_id) AS name
        FROM emt_messages
        WHERE (transaction_id, global_position) > (${bind(transaction)}::xid8, ${bind(position)}::bigint)
          AND transaction_id < (SELECT below FROM horizon)
          AND partition = ${bind(defaultPartition)} AND is_archived = FALSE
        ORDER BY transaction_id, global_position
        LIMIT ${bind(after === undefined ? 0 : most)}
      )
      SELECT horizon.below::text AS horizon, grouped.name, grouped.read, grouped.transaction, grouped.position
      FROM horizon LEFT JOIN (
        SELECT name, count(*)::int AS read,
          (array_agg(transaction_id::text ORDER BY transaction_id DESC, global_position DESC))[1] AS transaction,
          (array_agg(global_position::text ORDER BY transaction_id DESC, global_position DESC))[1] AS position
        FROM appended
        GROUP BY name
      ) AS grouped ON TRUE`,
      values,
    );
    const decoded = Schema.decodeUnknownSync(AppendedRows)(rows);
    return appendedOf(decoded[0].horizon, groupsOf(decoded), most);
  };
}
