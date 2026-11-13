import { Schema } from 'effect';

import { postgresqlAppended } from '../appended/postgresql-appended.ts';
import { postgresqlContentOn, type ContentConnections } from '../content/postgresql-content.ts';
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
} from '../event-store.ts';
import { dataAsJsonText } from '../postgresql/json-text.ts';
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
} from '../recorded/recorded-statements.ts';
import { playbookKeyOfStream, correlationOfMessage, orgOfStream } from './playbook-indexes.ts';
import { postgresqlDefinitionStreams } from './postgresql-definition-streams.ts';
import { examineRuns } from './postgresql-runs.ts';
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
  ofTheKeys,
  ofTypes,
  PointFields,
  sizedTypesOf,
  sizeOf,
  timeOf,
  type Bind,
  type Query,
} from './recorded-parts.ts';

export { formattedFor, type Query } from './recorded-parts.ts';

const ExaminedRecordRows = Schema.Array(Schema.Struct({ ...HeadFields, wanted: Schema.Boolean, examined: Schema.Int }));

const PointRows = Schema.Array(Schema.Struct(PointFields));

const DataRows = Schema.Array(Schema.Struct({ ...PointFields, data: Schema.Struct({ json: Schema.String }) }));

const RecordRows = Schema.Array(Schema.Struct({ ...HeadFields, data: Schema.Struct({ json: Schema.String }) }));

interface RecordsScope {
  readonly bind: Bind;
  readonly scope: ExaminationScope;
  readonly wanted: string;
  readonly partition: string;
  readonly horizon: string;
  readonly bounded: string;
  readonly limit: string;
}

function inOrder({ scope }: RecordsScope, prefix = ''): string {
  return `${prefix}transaction_id ${direction(scope)}, ${prefix}global_position ${direction(scope)}`;
}

interface Keyed {
  readonly key: string;
  readonly value: string;
}

function recordsWhere(
  keys: readonly Keyed[],
  records: RecordsScope,
  besides: (bind: Bind) => string = () => '',
): string {
  const matched = keys.map(({ key, value }) => matchedThroughItsIndex(records.bind, key, value)).join(' AND ');
  const kept = besides(records.bind);
  const ordered = keys.map(({ key }) => `${key} ${direction(records.scope)}`).join(', ');
  return `SELECT transaction_id, global_position, transaction_id::text AS transaction, global_position::text AS position,
      stream_id AS stream, stream_position::int AS version, message_type AS type, ${timeOf('created')} AS recorded,
      ${lineageColumns}, ${records.wanted} AS wanted, message_data
    FROM emt_messages
    WHERE ${matched}${kept} AND partition = ${records.partition}
      AND is_archived = FALSE${records.horizon}${records.bounded}
    ORDER BY ${ordered}, ${inOrder(records)}
    LIMIT ${records.limit}`;
}

function mergedInOrder(terms: readonly string[], records: RecordsScope): string {
  const [only, ...more] = terms;
  return more.length === 0 && only !== undefined
    ? only
    : `${terms.map((term) => `(${term})`).join(' UNION ALL ')} ORDER BY ${inOrder(records)} LIMIT ${records.limit}`;
}

function ofEachStream(streams: readonly string[], records: RecordsScope): string {
  return `${streams.map((stream) => `(${recordsWhere([{ key: isAKind(stream) ? playbookKeyOfStream : 'stream_id', value: stream }], records)})`).join(' UNION ALL ')} ORDER BY ${inOrder(records)} LIMIT ${records.limit}`;
}

function recordsIn(selected: RecordsSelected, records: RecordsScope): string {
  if (selected.kind === 'keys') {
    return mergedInOrder(
      selected.keys.map((key) => recordsWhere([{ key: playbookKeyOfStream, value: key }], records)),
      records,
    );
  }
  if (selected.kind === 'run') {
    return ofEachStream(selected.streams, records);
  }
  if (selected.kind === 'correlated') {
    const org = { key: orgOfStream, value: selected.org };
    return recordsWhere(
      [org, { key: correlationOfMessage, value: selected.correlation }],
      records,
      (bind) => ` AND ${ofTheKeys(bind, selected.keys)}`,
    );
  }
  return ofEachStream(selected.streams, records);
}

function examineRecords(query: Query): RecordedStatements['examineRecords'] {
  return async (selected, scope) => {
    const horizon = await horizonOf(query, scope);
    const { values, bind } = binding();
    const records: RecordsScope = {
      bind,
      scope,
      wanted: ofTypes(bind, 'message_type', scope.types),
      partition: bind(defaultPartition),
      horizon: horizon(bind),
      bounded: bounds(bind, scope),
      limit: bind(scope.examineAtMost + 1),
    };
    const size = sizeOf(
      { wanted: 'wanted', types: sizedTypesOf(bind, scope) },
      scope,
      { data: 'numbered.message_data', metadata: 'numbered.metadata' },
      'type',
    );
    const rows = await query(
      `SELECT transaction, position, stream, version, type, recorded, id, metadata, correlation, wanted,
          examined::int AS examined, ${size} AS size
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY ${inOrder(records, 'scanned.')}) AS examined,
            count(*) OVER () AS scanned_count
          FROM (${recordsIn(selected, records)}) AS scanned
        ) AS numbered
        WHERE wanted OR examined >= ${bind(scope.examineAtMost)} OR examined = scanned_count
        ORDER BY ${inOrder(records)}
        LIMIT ${bind(scope.answerAtMost)}`,
      values,
    );
    return Schema.decodeUnknownSync(ExaminedRecordRows)(rows).map((row): ExaminedItem => {
      const head = headOf(row);
      return { examined: row.examined, wanted: row.wanted, size: row.size, point: head.point, heads: [head] };
    });
  };
}

function firstSinceOf(bind: Bind, key: string, since: string): string {
  return `SELECT created, transaction_id, global_position FROM emt_messages
    WHERE ${playbookKeyOfStream} = ${bind(key)} AND partition = ${bind(defaultPartition)}
      AND is_archived = FALSE AND created >= ${bind(since)}::timestamptz
    ORDER BY created, transaction_id, global_position
    LIMIT 1`;
}

function firstSinceOfEach(bind: Bind, [only, ...more]: Keys, since: string): string {
  if (more.length === 0) {
    return firstSinceOf(bind, only, since);
  }
  const terms = [only, ...more].map((key) => `(${firstSinceOf(bind, key, since)})`);
  return `${terms.join(' UNION ALL ')} ORDER BY created, transaction_id, global_position LIMIT 1`;
}

function firstPointSince(query: Query): RecordedStatements['firstPointSince'] {
  return async (keys, since) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT transaction_id::text AS transaction, global_position::text AS position
        FROM (${firstSinceOfEach(bind, keys, since)}) AS first`,
      values,
    );
    return Schema.decodeUnknownSync(PointRows)(rows)
      .map(({ transaction, position }) => [transaction, position])
      .at(0);
  };
}

function dataAt(query: Query): RecordedStatements['dataAt'] {
  return async (points) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT m.transaction_id::text AS transaction, m.global_position::text AS position, m.message_data AS data
        FROM unnest(${bind(points.map(([transaction]) => transaction))}::xid8[],
          ${bind(points.map(([, position]) => position))}::bigint[]) AS wanted(transaction_id, global_position)
        JOIN emt_messages AS m
          ON m.transaction_id = wanted.transaction_id AND m.global_position = wanted.global_position
        WHERE m.partition = ${bind(defaultPartition)} AND m.is_archived = FALSE`,
      values,
    );
    return new Map(
      Schema.decodeUnknownSync(DataRows)(rows).map(({ transaction, position, data }) => [
        pointKey([transaction, position]),
        dataAsJsonText.read(data),
      ]),
    );
  };
}

function recordWithId(query: Query): RecordedStore['readRecordedEventOfKeys'] {
  return async ({ org, keys }, id) => {
    const { values, bind } = binding();
    const rows = await query(
      `WITH found AS MATERIALIZED (
          SELECT * FROM emt_messages
          WHERE ${orgOfStream} = ${bind(org)} AND message_id = ${bind(id)} AND partition = ${bind(defaultPartition)}
            AND is_archived = FALSE
        )
        SELECT transaction_id::text AS transaction, global_position::text AS position, stream_id AS stream,
          stream_position::int AS version, message_type AS type, ${timeOf('created')} AS recorded, ${lineageColumns},
          0 AS size, message_data AS data
        FROM found
        WHERE ${playbookKeyOfStream} = ANY(${bind(keys)}::text[])
        LIMIT 1`,
      values,
    );
    return Schema.decodeUnknownSync(RecordRows)(rows)
      .map((row) => recordOf(headOf(row), dataAsJsonText.read(row.data)))
      .at(0);
  };
}

export function postgresqlRecordedStore(
  query: Query,
  listeners: AppendListeners = {},
): RecordedStore &
  DefinitionStreamsStore &
  StreamAgesStore &
  StreamVersionsStore &
  LastMessagesStore &
  AppendWaitsStore {
  const appended = postgresqlAppended(query, listeners);
  const statements: RecordedStatements = {
    firstPointSince: firstPointSince(query),
    examineRecords: examineRecords(query),
    examineRuns: examineRuns(query),
    dataAt: dataAt(query),
  };
  return {
    ...postgresqlDefinitionStreams(query),
    ...appended,
    pointLength: 2,
    ...recordedReadsOver(statements, recordWithId(query)),
    readAppendedFacts: appendedFactsOver(statements, nowOf(appended.readAppended)),
  };
}

export function postgresqlRecordedStoreOn(
  query: Query,
  connections: ContentConnections,
  listeners: AppendListeners,
): RecordedStore &
  DefinitionStreamsStore &
  StreamAgesStore &
  StreamVersionsStore &
  LastMessagesStore &
  AppendWaitsStore &
  OwnContentStore {
  return { ...postgresqlRecordedStore(query, listeners), ...postgresqlContentOn(connections) };
}
