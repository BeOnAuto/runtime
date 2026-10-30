import { Schema } from 'effect';

import type {
  ExaminationScope,
  ExaminedItem,
  RecordedStatements,
  RunsSelected,
} from '../recorded/recorded-statements.ts';
import { kindKeyOfStream } from './playbook-indexes.ts';
import {
  binding,
  bounds,
  defaultPartition,
  direction,
  HeadFields,
  headOf,
  horizonOf,
  lineageColumns,
  matchedThroughItsIndex,
  ofTypes,
  orderedThroughItsIndex,
  sizedTypesOf,
  sizeOf,
  timeOf,
  type Bind,
  type Query,
} from './recorded-parts.ts';

const ExaminedRunRow = Schema.Struct({
  ...HeadFields,
  examined: Schema.Int,
  latest_transaction: Schema.String,
  latest_position: Schema.String,
  latest_version: Schema.Int,
  latest_type: Schema.String,
  latest_recorded: Schema.String,
  latest_id: Schema.String,
  latest_metadata: Schema.Unknown,
  latest_correlation: Schema.NullOr(Schema.String),
  wanted: Schema.Boolean,
  latest_size: Schema.Int,
});

function notOfTypes(bind: Bind, types: readonly string[]): string {
  return types.length === 0 ? '' : ` AND NOT ${ofTypes(bind, 'message_type', types)}`;
}

function ofTheDefinitionAsked(bind: Bind, { definitionType, name }: RunsSelected): string {
  const asked = [
    ...(definitionType === undefined ? [] : [`message_metadata ->> 'definitionType' = ${bind(definitionType)}`]),
    ...(name === undefined ? [] : [`message_metadata ->> 'definitionName' = ${bind(name)}`]),
  ];
  return asked.length === 0 ? 'TRUE' : asked.join(' AND ');
}

interface RunsScan {
  readonly bind: Bind;
  readonly partition: string;
  readonly horizon: string;
}

function firstMessagesOfRuns(
  { bind, partition, horizon }: RunsScan,
  scope: ExaminationScope,
  runs: RunsSelected,
): string {
  return `SELECT scanned.*, row_number() OVER (
      ORDER BY scanned.transaction_id ${direction(scope)}, scanned.global_position ${direction(scope)}
    ) AS examined, count(*) OVER () AS scanned_count
    FROM (
      SELECT transaction_id, global_position, transaction_id::text AS transaction,
        global_position::text AS position, stream_id AS stream, stream_position::int AS version,
        message_type AS type, ${timeOf('created')} AS recorded, ${lineageColumns}, message_data,
        ${ofTheDefinitionAsked(bind, runs)} AS of_the_definition
      FROM emt_messages
      WHERE ${matchedThroughItsIndex(bind, kindKeyOfStream, `${runs.playbookKey}runs/`)} AND stream_position = 1
        AND partition = ${partition} AND is_archived = FALSE${notOfTypes(bind, runs.notBeginningWith ?? [])}
        ${horizon}${bounds(bind, scope)}
      ORDER BY ${orderedThroughItsIndex(kindKeyOfStream, scope)}
      LIMIT ${bind(scope.examineAtMost + 1)}
    ) AS scanned`;
}

function examinedRunOf(row: typeof ExaminedRunRow.Type): ExaminedItem {
  const first = headOf(row);
  const alone = row.latest_transaction === row.transaction && row.latest_position === row.position;
  const latest = headOf({
    transaction: row.latest_transaction,
    position: row.latest_position,
    stream: row.stream,
    version: row.latest_version,
    type: row.latest_type,
    recorded: row.latest_recorded,
    id: row.latest_id,
    metadata: row.latest_metadata,
    correlation: row.latest_correlation,
    size: row.latest_size,
  });
  return {
    examined: row.examined,
    wanted: row.wanted,
    size: row.size + (alone ? 0 : row.latest_size),
    point: first.point,
    heads: alone ? [first] : [first, latest],
  };
}

export function examineRuns(query: Query): RecordedStatements['examineRuns'] {
  return async (scope, runs) => {
    const horizon = await horizonOf(query, scope);
    const { values, bind } = binding();
    const wanted = `${ofTypes(bind, 'latest.message_type', scope.types)} AND f.of_the_definition`;
    const sized = { wanted, types: sizedTypesOf(bind, scope) };
    const partition = bind(defaultPartition);
    const rows = await query(
      `SELECT f.transaction, f.position, f.stream, f.version, f.type, f.recorded, f.id, f.metadata, f.correlation,
          f.examined::int AS examined,
          latest.transaction_id::text AS latest_transaction, latest.global_position::text AS latest_position,
          latest.stream_position::int AS latest_version,
          latest.message_type AS latest_type, ${timeOf('latest.created')} AS latest_recorded,
          latest.message_id AS latest_id, latest.message_metadata AS latest_metadata,
          latest.message_metadata ->> 'correlationId' AS latest_correlation, ${wanted} AS wanted,
          ${sizeOf(sized, scope, 'f', 'f.type')} AS size,
          CASE WHEN latest.stream_position <> 1 THEN ${sizeOf(sized, scope, 'latest', 'latest.message_type')}
          ELSE 0 END AS latest_size
        FROM (${firstMessagesOfRuns({ bind, partition, horizon: horizon(bind) }, scope, runs)}) AS f
        CROSS JOIN LATERAL (
          SELECT transaction_id, global_position, stream_position, message_type, created, message_data,
            message_id, message_metadata
          FROM emt_messages AS m
          WHERE m.stream_id = f.stream AND m.partition = ${partition} AND m.is_archived = FALSE
          ORDER BY m.transaction_id DESC, m.global_position DESC
          LIMIT 1
        ) AS latest
        WHERE ${wanted} OR f.examined >= ${bind(scope.examineAtMost)} OR f.examined = f.scanned_count
        ORDER BY f.transaction_id ${direction(scope)}, f.global_position ${direction(scope)}
        LIMIT ${bind(scope.answerAtMost)}`,
      values,
    );
    return Schema.decodeUnknownSync(Schema.Array(ExaminedRunRow))(rows).map((row) => examinedRunOf(row));
  };
}
