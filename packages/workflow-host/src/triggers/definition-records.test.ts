import type { Trigger } from '@on.auto/definitions';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../reaction-testing/own-stops.ts';
import { cronTrigger, eventTrigger, everyTrigger } from '../reaction-testing/playbook-writes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { definitionRecordsIn, type DefinitionRecord } from './definition-records.ts';

const playbookKey = 'playbook/acme/alpha/';

const aMinute = 60_000;

const first = Date.parse('2026-10-01T09:00:00.000Z');

const nineTomorrow = Date.parse('2026-10-02T09:00:00.000Z');

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

const TypeRow = Schema.Struct({ workflow: Schema.String, type: Schema.String });

interface Saved {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly at?: number;
}

function about(name: string, version: number, at: string) {
  return { by: 'acme-admin', at, definitionType: 'workflow', definitionName: name, definitionVersion: version };
}

function saved({ id, name, version, triggers, at = first }: Saved): DefinitionRecord {
  const content = triggers.length === 0 ? { source: 'do: []' } : { source: 'schedule: {}', triggers };
  return {
    id,
    type: version === 1 ? 'definition_created' : 'definition_updated',
    data: { content },
    context: about(name, version, new Date(at).toISOString()),
  };
}

function retired(id: string, name: string): DefinitionRecord {
  return { id, type: 'definition_retired', data: {}, context: about(name, 1, '2026-10-02T00:00:00Z') };
}

async function applying() {
  const database = await openedOn(await onSQLite());
  const apply = definitionRecordsKeepingTheirOwnStops(database);
  return {
    database,
    applied: (...records: readonly DefinitionRecord[]) =>
      Effect.runPromise(Effect.forEach(records, (record) => apply(playbookKey, record))),
  };
}

function rowsIn(database: HostDatabase) {
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

function typesIn(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(
      TypeRow,
      database.read(statement`SELECT workflow, type FROM workflow_subscription_types ORDER BY workflow, type`),
    ),
  );
}

function runningSet(database: HostDatabase, reference: string, running: string) {
  return Effect.runPromise(
    database.write(statement`UPDATE workflow_subscriptions SET running = ${running} WHERE reference = ${reference}`),
  );
}

describe('the records of the definitions of a playbook, applied to its triggers', () => {
  it('give a version with triggers a row for each, and take them away at a version without, at its retirement', async () => {
    const { database, applied } = await applying();

    const outcomes = await applied(
      saved({ id: 's1', name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] }),
      saved({ id: 's2', name: 'plain', version: 1, triggers: [] }),
      saved({
        id: 's3',
        name: 'close',
        version: 1,
        triggers: [eventTrigger({ type: 'com.acme.closed' }), cronTrigger('0 9 * * *')],
      }),
      saved({ id: 's4', name: 'close', version: 2, triggers: [] }),
      saved({ id: 's5', name: 'gone', version: 1, triggers: [everyTrigger(aMinute)] }),
      retired('s6', 'gone'),
      { id: 's7', type: 'definition_created', data: { content: 7 }, context: { by: 'acme-admin', at: 'now' } },
    );
    const rows = await rowsIn(database);

    expect(outcomes).toEqual(['applied', 'applied', 'applied', 'applied', 'applied', 'applied', 'unreadable']);
    expect(rows.map(({ workflow, reference, kind }) => [workflow, reference, kind])).toEqual([
      ['tick', '/schedule/every', 'every'],
    ]);
    expect(await typesIn(database)).toEqual([]);
  });
});

describe('the triggers of a version', () => {
  it('have a row each, activated by the record of the version, with the types its event trigger names', async () => {
    const { database, applied } = await applying();
    const closed = eventTrigger({ type: 'com.acme.closed' }, { type: 'com.acme.reopened' });

    await applied(
      saved({
        id: 's1',
        name: 'close',
        version: 1,
        triggers: [closed, cronTrigger('0 9 * * *'), everyTrigger(15 * aMinute)],
      }),
    );

    expect(await rowsIn(database)).toEqual([
      row({ reference: '/schedule/cron', version: 1, kind: 'cron', by: 's1', at: first, due: nineTomorrow }),
      row({ reference: '/schedule/every', version: 1, kind: 'every', by: 's1', at: first, due: first + 15 * aMinute }),
      row({ reference: '/schedule/on', version: 1, kind: 'event', by: 's1', at: first, due: null }),
    ]);
    expect(await typesIn(database)).toEqual([
      { workflow: 'close', type: 'com.acme.closed' },
      { workflow: 'close', type: 'com.acme.reopened' },
    ]);
  });
});

interface Row {
  readonly reference: string;
  readonly version: number;
  readonly kind: string;
  readonly by: string;
  readonly at: number;
  readonly due: number | null;
}

function row({ reference, version, kind, by, at, due }: Row) {
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

describe('a new version of a workflow with triggers', () => {
  it('keeps the row of a trigger it leaves unchanged, with its anchor, its next due time and its running run', async () => {
    const { database, applied } = await applying();
    const triggers = [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(15 * aMinute)];
    await applied(saved({ id: 's1', name: 'close', version: 1, triggers }));
    await runningSet(database, '/schedule/every', 'run-1');

    await applied(saved({ id: 's2', name: 'close', version: 2, triggers, at: first + 7 * aMinute }));

    expect(await rowsIn(database)).toEqual([
      {
        ...row({
          reference: '/schedule/every',
          version: 2,
          kind: 'every',
          by: 's1',
          at: first,
          due: first + 15 * aMinute,
        }),
        running: 'run-1',
      },
      row({ reference: '/schedule/on', version: 2, kind: 'event', by: 's1', at: first, due: null }),
    ]);
  });
});

describe('a new version of a workflow that changes its triggers', () => {
  it('activates a changed trigger at its record, keeping a schedule its running run, and adds and removes the others', async () => {
    const { database, applied } = await applying();
    const later = first + 7 * aMinute;
    await applied(
      saved({
        id: 's1',
        name: 'close',
        version: 1,
        triggers: [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(15 * aMinute)],
      }),
    );
    await runningSet(database, '/schedule/every', 'run-1');

    await applied(
      saved({
        id: 's2',
        name: 'close',
        version: 2,
        triggers: [eventTrigger({ type: 'com.acme.opened' }), everyTrigger(aMinute), cronTrigger('0 9 * * *')],
        at: later,
      }),
    );

    expect(await rowsIn(database)).toEqual([
      row({ reference: '/schedule/cron', version: 2, kind: 'cron', by: 's2', at: later, due: nineTomorrow }),
      {
        ...row({ reference: '/schedule/every', version: 2, kind: 'every', by: 's2', at: later, due: later + aMinute }),
        running: 'run-1',
      },
      row({ reference: '/schedule/on', version: 2, kind: 'event', by: 's2', at: later, due: null }),
    ]);
    expect(await typesIn(database)).toEqual([{ workflow: 'close', type: 'com.acme.opened' }]);

    await applied(
      saved({ id: 's3', name: 'close', version: 3, triggers: [cronTrigger('0 9 * * *')], at: later + aMinute }),
    );

    expect(
      (await rowsIn(database)).map(({ reference, version, activated_by: by }) => [reference, version, by]),
    ).toEqual([['/schedule/cron', 3, 's2']]);
    expect(await typesIn(database)).toEqual([]);
  });
});

describe('a record of a definition applied again, as a pass that reads it again does', () => {
  it('changes nothing', async () => {
    const { database, applied } = await applying();
    const record = saved({
      id: 's1',
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(aMinute)],
    });
    await applied(record);
    await runningSet(database, '/schedule/every', 'run-1');
    const once = await rowsIn(database);

    await applied(record);

    expect(await rowsIn(database)).toEqual(once);
  });
});

describe('the records of the definitions read back from their stream', () => {
  it('are each given the id of its record, its type, its data and its context', () => {
    const context = { by: 'acme-admin', at: 'now', definitionName: 'close' };

    expect(
      definitionRecordsIn({
        version: 2,
        messages: [
          {
            type: 'definition_created',
            data: { content: { source: 'do: []' } },
            context,
            lineage: { id: 'm1', causationId: null, correlationId: null },
          },
          {
            type: 'definition_retired',
            data: {},
            context,
            lineage: { id: 'm2', causationId: null, correlationId: null },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'm1',
        type: 'definition_created',
        data: { content: { source: 'do: []' } },
        context,
      },
      { id: 'm2', type: 'definition_retired', data: {}, context },
    ]);
  });
});
