import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { ExaminationScope, ExaminedItem, RecordedStatements, RunsSelected } from './recorded-statements.ts';
import { correlationOfMessage, kindKeyOfStream } from './sqlite-indexes.ts';
import { bounds, defaultPartition, direction, HeadFields, headOf, ofTypes, sizeOf } from './sqlite-parts.ts';

const ExaminedRunRow = Schema.Struct({
  ...HeadFields,
  examined: Schema.Int,
  size: Schema.Int,
  latest_position: Schema.Int,
  latest_version: Schema.Int,
  latest_type: Schema.String,
  latest_recorded: Schema.String,
  latest_size: Schema.Int,
  latest_id: Schema.String,
  latest_metadata: Schema.fromJsonString(Schema.Unknown),
  latest_correlation: Schema.NullOr(Schema.String),
  wanted: Schema.Int,
});

function notOfTypes(column: string, types: readonly string[]): SQL {
  return types.length === 0 ? SQL`` : SQL` AND NOT ${ofTypes(column, types)}`;
}

function ofTheDefinitionAsked({ definitionType, name }: RunsSelected): SQL {
  const asked: SQL[] = [
    ...(definitionType === undefined
      ? []
      : [SQL`json_extract(message_metadata, '$.definitionType') IS ${definitionType}`]),
    ...(name === undefined ? [] : [SQL`json_extract(message_metadata, '$.definitionName') IS ${name}`]),
  ];
  return asked.length === 0 ? SQL`1` : SQL.merge(asked, ' AND ');
}

function firstMessagesOfRuns(scope: ExaminationScope, runs: RunsSelected): SQL {
  return SQL`SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined,
      count(*) OVER () AS scanned_count
    FROM (
      SELECT global_position AS position, stream_id AS stream, stream_position AS version,
        message_type AS type, created AS recorded, message_id AS id, message_metadata AS metadata,
        ${correlationOfMessage} AS correlation, octet_length(message_data) AS size,
        ${ofTheDefinitionAsked(runs)} AS of_the_definition
      FROM emt_messages
      WHERE ${kindKeyOfStream} = ${`${runs.playbookKey}runs/`} AND stream_position = 1
        AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}${notOfTypes('message_type', runs.notBeginningWith ?? [])}
      ORDER BY global_position ${direction(scope)}
      LIMIT ${scope.examineAtMost + 1}
    ) AS scanned`;
}

function examinedRunOf(row: typeof ExaminedRunRow.Type): ExaminedItem {
  const first = headOf(row);
  const alone = row.latest_position === row.position;
  const wanted = row.wanted === 1;
  const latest = headOf({
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
    wanted,
    size: row.size + (alone ? 0 : row.latest_size),
    point: first.point,
    heads: alone ? [first] : [first, latest],
  };
}

export function examineRuns(execute: SQLExecutor): RecordedStatements['examineRuns'] {
  return async (scope, runs) => {
    const wanted = SQL`${ofTypes('latest.message_type', scope.types)} AND f.of_the_definition`;
    const { rows } = await execute.query(
      SQL`SELECT f.position, f.stream, f.version, f.type, f.recorded, f.id, f.metadata, f.correlation, f.examined,
          ${sizeOf(scope, wanted, 'f.type', 'f.size')} AS size,
          latest.global_position AS latest_position, latest.stream_position AS latest_version,
          latest.message_type AS latest_type, latest.created AS latest_recorded,
          ${sizeOf(scope, wanted, 'latest.message_type', 'octet_length(latest.message_data)')} AS latest_size,
          latest.message_id AS latest_id, latest.message_metadata AS latest_metadata,
          json_extract(latest.message_metadata, '$.correlationId') AS latest_correlation, ${wanted} AS wanted
        FROM (${firstMessagesOfRuns(scope, runs)}) AS f
        JOIN emt_messages AS latest
          ON latest.stream_id = f.stream AND latest.partition = ${defaultPartition} AND latest.is_archived = FALSE
          AND latest.stream_position = (
            SELECT max(m.stream_position) FROM emt_messages AS m
            WHERE m.stream_id = f.stream AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
          )
        WHERE ${wanted} OR f.examined >= ${scope.examineAtMost} OR f.examined = f.scanned_count
        ORDER BY f.examined
        LIMIT ${scope.answerAtMost}`,
    );
    return Schema.decodeUnknownSync(Schema.Array(ExaminedRunRow))(rows).map((row) => examinedRunOf(row));
  };
}
