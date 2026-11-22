import { statement, type Dialect, type Statement } from '@on.auto/ledger';
import { streamPrefixOfDefinition } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { FiledRun } from '../runs/run-address.ts';

interface QueuedStarts {
  readonly queued: number;
  readonly nextDueAt: number | null;
}

interface QueuedEvent {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly subject?: string;
  readonly time: string;
}

export interface QueuedStart {
  readonly runId: string;
  readonly event: QueuedEvent;
  readonly dueAt: number;
  readonly attempts: number;
}

export interface QueuedPlace {
  readonly dueAt: number;
  readonly runId: string;
}

interface QueuedStartsAsked {
  readonly after?: QueuedPlace;
  readonly limit: number;
}

interface QueuedStartsPage {
  readonly starts: readonly QueuedStart[];
  readonly more: boolean;
}

type FiledWorkflow = Omit<FiledRun, 'runId'>;

export interface QueuedStartReads {
  readonly queuedStartsOf: (workflow: FiledWorkflow) => Effect.Effect<QueuedStarts>;
  readonly queuedStartsPage: (workflow: FiledWorkflow, asked: QueuedStartsAsked) => Effect.Effect<QueuedStartsPage>;
}

type QueueDatabase = Pick<HostDatabase, 'dialect' | 'read'>;

const QueuedRow = Schema.Struct({ queued: WholeNumber, due: Schema.NullOr(WholeNumber) });

const QueuedStartRow = Schema.Struct({
  run_id: Schema.String,
  due: WholeNumber,
  attempts: WholeNumber,
  event_id: Schema.String,
  event_type: Schema.String,
  event_source: Schema.String,
  event_subject: Schema.NullOr(Schema.String),
  event_time: Schema.String,
});

function queuedOfAWorkflow(definitionKey: string): Statement {
  return statement`SELECT count(*) AS queued, MIN(due) AS due
    FROM workflow_reaction_backlog WHERE definition_key = ${definitionKey}`;
}

function sqlitePageOf(definitionKey: string, { after, limit }: QueuedStartsAsked): Statement {
  return after === undefined
    ? statement`SELECT run_id, due, attempts,
          json_extract(start, '$.input[0].id') AS event_id,
          json_extract(start, '$.input[0].type') AS event_type,
          json_extract(start, '$.input[0].source') AS event_source,
          json_extract(start, '$.input[0].subject') AS event_subject,
          json_extract(start, '$.input[0].time') AS event_time
        FROM workflow_reaction_backlog
        WHERE definition_key = ${definitionKey}
        ORDER BY due, run_id LIMIT ${limit + 1}`
    : statement`SELECT run_id, due, attempts,
          json_extract(start, '$.input[0].id') AS event_id,
          json_extract(start, '$.input[0].type') AS event_type,
          json_extract(start, '$.input[0].source') AS event_source,
          json_extract(start, '$.input[0].subject') AS event_subject,
          json_extract(start, '$.input[0].time') AS event_time
        FROM workflow_reaction_backlog
        WHERE definition_key = ${definitionKey} AND (due, run_id) > (${after.dueAt}, ${after.runId})
        ORDER BY due, run_id LIMIT ${limit + 1}`;
}

function postgresqlPageOf(definitionKey: string, { after, limit }: QueuedStartsAsked): Statement {
  return after === undefined
    ? statement`WITH page AS (
          SELECT run_id, due, attempts, start FROM workflow_reaction_backlog
          WHERE definition_key = ${definitionKey}
          ORDER BY due, run_id LIMIT ${limit + 1}
        ), parsed AS MATERIALIZED (
          SELECT run_id, due, attempts, CAST(start AS jsonb) AS start FROM page
        )
        SELECT run_id, due, attempts,
          start #>> '{input,0,id}' AS event_id,
          start #>> '{input,0,type}' AS event_type,
          start #>> '{input,0,source}' AS event_source,
          start #>> '{input,0,subject}' AS event_subject,
          start #>> '{input,0,time}' AS event_time
        FROM parsed ORDER BY due, run_id`
    : statement`WITH page AS (
          SELECT run_id, due, attempts, start FROM workflow_reaction_backlog
          WHERE definition_key = ${definitionKey} AND (due, run_id) > (${after.dueAt}, ${after.runId})
          ORDER BY due, run_id LIMIT ${limit + 1}
        ), parsed AS MATERIALIZED (
          SELECT run_id, due, attempts, CAST(start AS jsonb) AS start FROM page
        )
        SELECT run_id, due, attempts,
          start #>> '{input,0,id}' AS event_id,
          start #>> '{input,0,type}' AS event_type,
          start #>> '{input,0,source}' AS event_source,
          start #>> '{input,0,subject}' AS event_subject,
          start #>> '{input,0,time}' AS event_time
        FROM parsed ORDER BY due, run_id`;
}

const pageOfAWorkflow: Readonly<Record<Dialect, (definitionKey: string, asked: QueuedStartsAsked) => Statement>> = {
  sqlite: sqlitePageOf,
  postgresql: postgresqlPageOf,
};

function queuedStartOf(row: typeof QueuedStartRow.Type): QueuedStart {
  const { event_id: id, event_type: type, event_source: source, event_subject: subject, event_time: time } = row;
  return {
    runId: row.run_id,
    event: { id, type, source, ...(subject === null ? {} : { subject }), time },
    dueAt: row.due,
    attempts: row.attempts,
  };
}

function queuedStartsOf(database: QueueDatabase, definitionKey: string): Effect.Effect<QueuedStarts> {
  return Effect.orDie(oneRowOf(QueuedRow, database.read(queuedOfAWorkflow(definitionKey)))).pipe(
    Effect.map(({ queued, due }) => ({ queued, nextDueAt: due })),
  );
}

function queuedStartsPage(
  database: QueueDatabase,
  definitionKey: string,
  asked: QueuedStartsAsked,
): Effect.Effect<QueuedStartsPage> {
  return Effect.orDie(
    rowsOf(QueuedStartRow, database.read(pageOfAWorkflow[database.dialect](definitionKey, asked))),
  ).pipe(
    Effect.map((rows) => ({
      starts: rows.slice(0, asked.limit).map((row) => queuedStartOf(row)),
      more: rows.length > asked.limit,
    })),
  );
}

export function queuedStartsOn(database: QueueDatabase): QueuedStartReads {
  return {
    queuedStartsOf: (workflow) => queuedStartsOf(database, streamPrefixOfDefinition(workflow)),
    queuedStartsPage: (workflow, asked) => queuedStartsPage(database, streamPrefixOfDefinition(workflow), asked),
  };
}
