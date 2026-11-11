import { SQL } from '@event-driven-io/dumbo';
import { checkpointsOf, projectedTableOf, type CountedRows, type StreamProjection } from '@on.auto/operations';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { tableOf } from '../projections/projection-statements.ts';

const defaultPartition = 'emt:default';

export interface StreamPlace {
  readonly prefix: string;
  readonly stream: string;
}

export interface StreamFreshness {
  readonly stream: string;
  readonly head: number;
  readonly folded: number;
}

const FreshnessRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, head: Schema.Number, folded: Schema.Number }),
);

const SizedRows = Schema.Array(Schema.Struct({ position: Schema.Number, size: Schema.Number }));

const FoldedRows = Schema.Array(Schema.Struct({ folded: Schema.Number }));

const CountRows = Schema.Tuple([Schema.Struct({ rows: Schema.Number, facts: Schema.Number })]);

const MessageRows = Schema.Array(
  Schema.Struct({
    stream: Schema.String,
    type: Schema.String,
    data: Schema.Unknown,
    metadata: Schema.Unknown,
    position: Schema.Number,
  }),
);

export type StreamMessage = (typeof MessageRows.Type)[number];

function checkpointsTableOf(projection: StreamProjection): string {
  return projectedTableOf(checkpointsOf(projection));
}

function checkpoints(projection: StreamProjection): SQL {
  return SQL`${SQL.plain(checkpointsTableOf(projection))}`;
}

export function checkpointsCreated({ columnTypes }: ProjectionDialect, projection: StreamProjection): SQL {
  return SQL`CREATE TABLE IF NOT EXISTS ${checkpoints(projection)} (
      playbook_key ${SQL.plain(columnTypes.text)} NOT NULL,
      stream ${SQL.plain(columnTypes.text)} NOT NULL,
      folded_through ${SQL.plain(columnTypes.integer)} NOT NULL,
      PRIMARY KEY (playbook_key, stream)
    )`;
}

export function emptied(projection: StreamProjection, prefix: string): readonly SQL[] {
  return [
    ...projection.tables.map((table) => SQL`DELETE FROM ${tableOf(table)} WHERE playbook_key = ${prefix}`),
    SQL`DELETE FROM ${checkpoints(projection)} WHERE playbook_key = ${prefix}`,
  ];
}

export function everyRowEmptied(projection: StreamProjection): readonly SQL[] {
  return [
    ...projection.tables.map((table) => SQL`DELETE FROM ${tableOf(table)}`),
    SQL`DELETE FROM ${checkpoints(projection)}`,
  ];
}

export async function checkpointLocked(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: StreamProjection,
  { prefix, stream }: StreamPlace,
): Promise<number> {
  const table = checkpointsTableOf(projection);
  await inTurn(dialect.keyLocks(table, prefix, stream), (lock) => execute.query(lock));
  const { rows } = await execute.query(
    SQL`SELECT CAST(folded_through AS DOUBLE PRECISION) AS folded FROM ${checkpoints(projection)}
      WHERE playbook_key = ${prefix} AND stream = ${stream}${SQL.plain(dialect.forUpdate)}`,
  );
  const [found] = Schema.decodeUnknownSync(FoldedRows)(rows);
  return found === undefined ? 0 : found.folded;
}

export function checkpointWritten(projection: StreamProjection, { prefix, stream }: StreamPlace, through: number): SQL {
  return SQL`INSERT INTO ${checkpoints(projection)} (playbook_key, stream, folded_through)
    VALUES (${prefix}, ${stream}, ${through})
    ON CONFLICT (playbook_key, stream) DO UPDATE SET folded_through = excluded.folded_through`;
}

export async function freshnessOf(
  query: (sql: SQL) => Promise<readonly unknown[]>,
  dialect: ProjectionDialect,
  projection: StreamProjection,
  prefix: string,
): Promise<readonly StreamFreshness[]> {
  const relative = projection.streams.map((id) => `${projection.kind}/${id}`);
  const rows = await query(
    SQL`SELECT n.value AS stream,
        CAST(coalesce((SELECT s.stream_position FROM emt_streams AS s
          WHERE s.stream_id = ${prefix} || n.value AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
        ), 0) AS DOUBLE PRECISION) AS head,
        CAST(coalesce((SELECT c.folded_through FROM ${checkpoints(projection)} AS c
          WHERE c.playbook_key = ${prefix} AND c.stream = n.value
        ), 0) AS DOUBLE PRECISION) AS folded
      FROM (${dialect.listed(relative)}) AS n
      ORDER BY n.value`,
  );
  return Schema.decodeUnknownSync(FreshnessRows)(rows);
}

export async function sizesAfter(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  stream: string,
  { after, count }: { readonly after: number; readonly count: number },
) {
  const { rows } = await execute.query(
    SQL`SELECT CAST(m.stream_position AS DOUBLE PRECISION) AS position,
        CAST(${SQL.plain(dialect.storedBytesOfMessage)} AS DOUBLE PRECISION) AS size
      FROM emt_messages AS m
      WHERE m.stream_id = ${stream} AND m.stream_position > ${after}
        AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ORDER BY m.stream_position
      LIMIT ${count}`,
  );
  return Schema.decodeUnknownSync(SizedRows)(rows);
}

export async function messagesThrough(
  execute: StatementExecutor,
  stream: string,
  { after, through }: { readonly after: number; readonly through: number },
): Promise<readonly StreamMessage[]> {
  const { rows } = await execute.query(
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        CAST(stream_position AS DOUBLE PRECISION) AS position
      FROM emt_messages
      WHERE stream_id = ${stream} AND stream_position > ${after} AND stream_position <= ${through}
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_position`,
  );
  return Schema.decodeUnknownSync(MessageRows)(rows);
}

export interface Counted {
  readonly rows: number;
  readonly facts: number;
}

export async function countedIn(
  query: (sql: SQL) => Promise<readonly unknown[]>,
  dialect: ProjectionDialect,
  projection: StreamProjection,
  { prefix, counted }: { readonly prefix: string; readonly counted: CountedRows },
): Promise<Counted> {
  const rows = await query(
    SQL`SELECT
        (SELECT CAST(count(*) AS INTEGER) FROM ${tableOf({ name: counted.projection, version: projection.version })}
          WHERE playbook_key = ${prefix}) AS rows,
        (SELECT CAST(count(*) AS INTEGER) FROM emt_messages AS m
          JOIN ${checkpoints(projection)} AS c
            ON c.playbook_key = ${prefix} AND m.stream_id = ${prefix} || c.stream AND m.stream_position <= c.folded_through
          WHERE m.message_type IN (${dialect.listed(counted.facts)})
            AND m.partition = ${defaultPartition} AND m.is_archived = FALSE) AS facts`,
  );
  const [found] = Schema.decodeUnknownSync(CountRows)(rows);
  return found;
}
