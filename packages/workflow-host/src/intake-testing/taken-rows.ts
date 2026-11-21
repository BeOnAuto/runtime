import { publishedEventOf } from '@on.auto/definitions';
import { statement, statementOf } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { alpha, definitionKeyNamed } from '../reaction-testing/playbook-writes.ts';
import { triggersPaused } from '../triggers/trigger-rows.ts';
import { takenAt } from './taking-in.ts';

export function paused(database: HostDatabase, name: string): Promise<void> {
  return Effect.runPromise(triggersPaused(database, { playbookKey: alpha, definitionKey: definitionKeyNamed(name) }));
}

const StreamRow = Schema.Struct({ stream_id: Schema.String });

export async function recordedIn(database: HostDatabase) {
  const streams = await Effect.runPromise(
    rowsOf(
      StreamRow,
      database.read(statement`SELECT DISTINCT stream_id FROM emt_messages WHERE message_type = 'event_published'`),
    ),
  );
  const read = await Promise.all(streams.map(({ stream_id: stream }) => database.store.read(stream)));
  return read.flatMap(({ messages }) => messages.map((message) => publishedEventOf(message)));
}

const OutcomeRow = Schema.Struct({
  definition_key: Schema.String,
  trigger_reference: Schema.String,
  reason: Schema.String,
  count: WholeNumber,
  last_at: WholeNumber,
});

export function outcomesIn(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(
      OutcomeRow,
      database.read(statement`SELECT definition_key, trigger_reference, reason, count, last_at
        FROM workflow_trigger_outcomes WHERE playbook_key = ${alpha} ORDER BY reason, definition_key`),
    ),
  );
}

export function counted(name: string, reason: string, count = 1) {
  const beforeAnyTrigger = name === '';
  return {
    definition_key: beforeAnyTrigger ? '' : definitionKeyNamed(name),
    trigger_reference: beforeAnyTrigger ? '' : '/schedule/on',
    reason,
    count,
    last_at: takenAt,
  };
}

const TableRow = Schema.Struct({ name: Schema.String });

export async function holdsAnywhere(database: HostDatabase, text: string): Promise<boolean> {
  const tables = await Effect.runPromise(
    rowsOf(TableRow, database.read(statement`SELECT name FROM sqlite_master WHERE type = 'table'`)),
  );
  const rows = await Promise.all(
    tables.map(({ name }) => Effect.runPromise(database.read(statementOf([`SELECT * FROM "${name}"`], [])))),
  );
  return JSON.stringify(rows).includes(text);
}
