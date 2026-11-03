import type { Trigger } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import type { DefinitionRecord } from '../triggers/definition-records.ts';
import { definitionRecordsKeepingTheirOwnStops } from './own-stops.ts';

const playbookKey = 'playbook/acme/alpha/';

export const first = Date.parse('2026-10-01T09:00:00.000Z');

const TriggerRow = Schema.Struct({
  workflow: Schema.String,
  reference: Schema.String,
  version: WholeNumber,
  kind: Schema.String,
  activated_by: Schema.String,
  activated_at: WholeNumber,
  next_due: Schema.NullOr(WholeNumber),
  running: Schema.NullOr(Schema.String),
});

interface Saved {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly at?: number;
}

export function about(name: string, version: number, at: string) {
  return { by: 'acme-admin', at, definitionType: 'workflow', definitionName: name, definitionVersion: version };
}

export function saved({ id, name, version, triggers, at = first }: Saved): DefinitionRecord {
  const content = triggers.length === 0 ? { source: 'do: []' } : { source: 'schedule: {}', triggers };
  const context = about(name, version, new Date(at).toISOString());
  return version === 1
    ? {
        id,
        type: 'definition_created',
        data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } },
        context,
      }
    : { id, type: 'definition_updated', data: { content }, context };
}

export function retired(id: string, name: string): DefinitionRecord {
  return { id, type: 'definition_retired', data: {}, context: about(name, 1, '2026-10-02T00:00:00Z') };
}

export async function applying(through: (database: HostDatabase) => HostDatabase = (database) => database) {
  const database = await openedOn(await onSQLite());
  const apply = definitionRecordsKeepingTheirOwnStops(through(database));
  return {
    database,
    applied: (...records: readonly DefinitionRecord[]) =>
      Effect.runPromise(Effect.forEach(records, (record) => apply(playbookKey, record))),
  };
}

export function rowsIn(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(
      TriggerRow,
      database.read(
        statement`SELECT workflow, reference, version, kind, activated_by, activated_at, next_due, running
          FROM workflow_subscriptions ORDER BY workflow, reference`,
      ),
    ),
  );
}

export function runningSet(database: HostDatabase, reference: string, running: string) {
  return Effect.runPromise(
    database.write(statement`UPDATE workflow_subscriptions SET running = ${running} WHERE reference = ${reference}`),
  );
}

interface Row {
  readonly reference: string;
  readonly version: number;
  readonly kind: string;
  readonly by: string;
  readonly at: number;
  readonly due: number | null;
}

export function row({ reference, version, kind, by, at, due }: Row) {
  return {
    workflow: 'close',
    reference,
    version,
    kind,
    activated_by: by,
    activated_at: at,
    next_due: due,
    running: null,
  };
}
