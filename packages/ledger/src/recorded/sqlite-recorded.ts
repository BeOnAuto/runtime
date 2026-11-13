import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { sqliteAppended } from '../appended/sqlite-appended.ts';
import { sqliteContentOn } from '../content/content-store.ts';
import { sqliteDefinitionStreams } from '../definitions/sqlite-definition-streams.ts';
import {
  isAKind,
  type AppendListeners,
  type AppendWaitsStore,
  type DefinitionStreamsStore,
  type LastMessagesStore,
  type OwnContentStore,
  type RecordedStore,
  type StreamAgesStore,
  type StreamVersionsStore,
  type TransactionalPool,
} from '../event-store.ts';
import {
  appendedFactsOver,
  nowOf,
  pointKey,
  recordOf,
  recordedReadsOver,
  type ExaminationScope,
  type ExaminedItem,
  type Keys,
  type RecordedStatements,
  type RecordsSelected,
} from './recorded-statements.ts';
import { playbookKeyOfStream, correlationOfMessage, dataBytesOfMessage, orgOfStream } from './sqlite-indexes.ts';
import {
  bounds,
  DataRows,
  defaultPartition,
  direction,
  ExaminedRecordRows,
  eachWalkedInTurn,
  headOf,
  listed,
  oneOrEachInTurn,
  ofTypes,
  positionOf,
  PositionRows,
  RecordRows,
  secondOf,
  sizeOf,
  walkedInTheOrderOf,
} from './sqlite-parts.ts';
import { examineRuns } from './sqlite-runs.ts';

function recordsWhere(where: SQL, scope: ExaminationScope): SQL {
  return SQL`SELECT global_position AS position, stream_id AS stream, stream_position AS version,
      message_type AS type, created AS recorded, message_id AS id, message_metadata AS metadata,
      ${correlationOfMessage} AS correlation,
      ${ofTypes('message_type', scope.types)} AS wanted, ${dataBytesOfMessage} AS size
    FROM emt_messages
    WHERE ${where} AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}
    ORDER BY global_position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function ofEachStream(streams: readonly string[]): SQL {
  const named = streams.map((stream) =>
    isAKind(stream) ? SQL`${playbookKeyOfStream} = ${stream}` : SQL`stream_id = ${stream}`,
  );
  return SQL`(${SQL.merge(named, ' OR ')})`;
}

function ofTheRun({ keys, streams }: { readonly keys: Keys; readonly streams: Keys }, scope: ExaminationScope): SQL {
  const walk = walkedInTheOrderOf(scope);
  return keys.length === 1
    ? ofEachStream(streams)
    : eachWalkedInTurn(streams, (stream) => walk(SQL`stream_id = ${stream}`));
}

function ofTheKeys(keys: Keys, scope: ExaminationScope): SQL {
  return oneOrEachInTurn(keys, (key) => SQL`${playbookKeyOfStream} = ${key}`, walkedInTheOrderOf(scope));
}

function recordsIn(selected: RecordsSelected, scope: ExaminationScope): SQL {
  if (selected.kind === 'keys') {
    return recordsWhere(ofTheKeys(selected.keys, scope), scope);
  }
  if (selected.kind === 'run') {
    return recordsWhere(ofTheRun(selected, scope), scope);
  }
  if (selected.kind === 'correlated') {
    return recordsWhere(
      SQL`${orgOfStream} = ${selected.org} AND ${correlationOfMessage} = ${selected.correlation}
        AND ${playbookKeyOfStream} IN ${listed(selected.keys)}`,
      scope,
    );
  }
  return recordsWhere(ofEachStream(selected.streams), scope);
}

function examineRecords(execute: SQLExecutor): RecordedStatements['examineRecords'] {
  return async (selected, scope) => {
    const { rows } = await execute.query(
      SQL`SELECT position, stream, version, type, recorded, id, metadata, correlation, wanted,
          ${sizeOf(scope, SQL`wanted`, 'type', 'size')} AS size, examined
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined,
            count(*) OVER () AS scanned_count
          FROM (${recordsIn(selected, scope)}) AS scanned
        )
        WHERE wanted OR examined >= ${scope.examineAtMost} OR examined = scanned_count
        ORDER BY examined
        LIMIT ${scope.answerAtMost}`,
    );
    return Schema.decodeUnknownSync(ExaminedRecordRows)(rows).map((row): ExaminedItem => {
      const head = headOf(row);
      return { examined: row.examined, wanted: row.wanted === 1, size: row.size, point: head.point, heads: [head] };
    });
  };
}

function firstPointSince(execute: SQLExecutor): RecordedStatements['firstPointSince'] {
  return async (keys, since) => {
    const { rows } = await execute.query(
      SQL`SELECT global_position AS position FROM emt_messages
        WHERE ${oneOrEachInTurn(
          keys,
          (key) => SQL`${playbookKeyOfStream} = ${key}`,
          (matched) => SQL`SELECT global_position FROM emt_messages
            WHERE ${matched} AND partition = ${defaultPartition} AND is_archived = FALSE AND created >= ${secondOf(since)}
            ORDER BY created, global_position
            LIMIT 1`,
        )} AND partition = ${defaultPartition} AND is_archived = FALSE
          AND created >= ${secondOf(since)}
        ORDER BY created, global_position
        LIMIT 1`,
    );
    return Schema.decodeUnknownSync(PositionRows)(rows)
      .map(({ position }) => [String(position)])
      .at(0);
  };
}

function dataAt(execute: SQLExecutor): RecordedStatements['dataAt'] {
  return async (points) => {
    const positions = points.map((point) => positionOf(point));
    const { rows } = await execute.query(
      SQL`SELECT global_position AS position, message_data AS data FROM emt_messages
        WHERE global_position IN (SELECT value FROM json_each(${JSON.stringify(positions)}))`,
    );
    return new Map(
      Schema.decodeUnknownSync(DataRows)(rows).map(({ position, data }) => [pointKey([String(position)]), data]),
    );
  };
}

function recordWithId(execute: SQLExecutor): RecordedStore['readRecordedEventOfKeys'] {
  return async ({ org, keys }, id) => {
    const { rows } = await execute.query(
      SQL`WITH found AS MATERIALIZED (
          SELECT * FROM emt_messages
          WHERE ${orgOfStream} = ${org} AND message_id = ${id} AND partition = ${defaultPartition} AND is_archived = FALSE
        )
        SELECT global_position AS position, stream_id AS stream, stream_position AS version,
          message_type AS type, created AS recorded, message_id AS id, message_metadata AS metadata,
          ${correlationOfMessage} AS correlation, 0 AS size, message_data AS data
        FROM found
        WHERE ${playbookKeyOfStream} IN ${listed(keys)}
        LIMIT 1`,
    );
    return Schema.decodeUnknownSync(RecordRows)(rows)
      .map((row) => recordOf(headOf(row), row.data))
      .at(0);
  };
}

export function sqliteRecordedStore(
  execute: SQLExecutor,
  listeners: AppendListeners = {},
): RecordedStore &
  DefinitionStreamsStore &
  StreamAgesStore &
  StreamVersionsStore &
  LastMessagesStore &
  AppendWaitsStore {
  const appended = sqliteAppended(execute, listeners);
  const statements: RecordedStatements = {
    firstPointSince: firstPointSince(execute),
    examineRecords: examineRecords(execute),
    examineRuns: examineRuns(execute),
    dataAt: dataAt(execute),
  };
  return {
    ...sqliteDefinitionStreams(execute),
    ...appended,
    pointLength: 1,
    ...recordedReadsOver(statements, recordWithId(execute)),
    readAppendedFacts: appendedFactsOver(statements, nowOf(appended.readAppended)),
  };
}

export function sqliteRecordedStoreOn(
  pool: TransactionalPool<SQLExecutor>,
  listeners: AppendListeners,
): RecordedStore &
  DefinitionStreamsStore &
  StreamAgesStore &
  StreamVersionsStore &
  LastMessagesStore &
  AppendWaitsStore &
  OwnContentStore {
  return { ...sqliteRecordedStore(pool.execute, listeners), ...sqliteContentOn(pool) };
}
