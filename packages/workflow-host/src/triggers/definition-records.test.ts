import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import {
  about,
  applying,
  first,
  retired,
  row,
  rowsIn,
  runningSet,
  saved,
} from '../reaction-testing/applied-records.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../reaction-testing/own-stops.ts';
import { cronTrigger, definitionKeyNamed, eventTrigger, everyTrigger } from '../reaction-testing/playbook-writes.ts';
import { definitionRecordsIn } from './definition-records.ts';

const aMinute = 60_000;

const nineTomorrow = Date.parse('2026-10-02T09:00:00.000Z');

const TypeRow = Schema.Struct({ definition_key: Schema.String, type: Schema.String });

function typesIn(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(
      TypeRow,
      database.read(
        statement`SELECT definition_key, type FROM workflow_subscription_types ORDER BY definition_key, type`,
      ),
    ),
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
    expect(rows.map(({ definition_key: key, reference, kind }) => [key, reference, kind])).toEqual([
      [definitionKeyNamed('tick'), '/schedule/every', 'every'],
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
      { definition_key: definitionKeyNamed('close'), type: 'com.acme.closed' },
      { definition_key: definitionKeyNamed('close'), type: 'com.acme.reopened' },
    ]);
  });
});

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
    expect(await typesIn(database)).toEqual([{ definition_key: definitionKeyNamed('close'), type: 'com.acme.opened' }]);

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
            data: { content: { source: 'do: []' }, created_by: { id: 'acme-admin', name: 'acme-admin' } },
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
        data: { content: { source: 'do: []' }, created_by: { id: 'acme-admin', name: 'acme-admin' } },
        context,
      },
      { id: 'm2', type: 'definition_retired', data: {}, context },
    ]);
  });
});

const PlacedRow = Schema.Struct({ playbook_key: Schema.String });

function playbooksIn(database: HostDatabase) {
  return Effect.runPromise(
    Effect.all(
      [
        statement`SELECT playbook_key FROM workflow_subscriptions ORDER BY reference`,
        statement`SELECT playbook_key FROM workflow_subscription_types ORDER BY type`,
        statement`SELECT playbook_key FROM workflow_reaction_refusals`,
      ].map((read) => rowsOf(PlacedRow, database.read(read))),
    ),
  );
}

const refusedOnce = statement`INSERT INTO workflow_reaction_refusals
  (definition_key, playbook_key, workflow, version, minute, count, reason, trigger_kind, trigger_reference)
  VALUES (${definitionKeyNamed('close')}, 'playbook/acme/alpha/', 'close', 1, 0, 1, 'refused', 'cron', '/schedule/cron')`;

const movedToBeta = {
  id: 'm1',
  type: 'definition_moved',
  data: { from: 'alpha', to: 'beta', moved_by: { id: 'acme-admin', name: 'acme-admin' } },
  context: about('close', 1, '2026-10-01T10:00:00.000Z'),
};

describe('a move of a workflow to another playbook', () => {
  it('gives its triggers, the types they match and its refusals the key of that playbook, their times untouched', async () => {
    const { database, applied } = await applying();
    await applied(
      saved({
        id: 's1',
        name: 'close',
        version: 1,
        triggers: [eventTrigger({ type: 'com.acme.closed' }), cronTrigger('0 9 * * *')],
      }),
    );
    await Effect.runPromise(database.write(refusedOnce));
    const before = await rowsIn(database);

    expect(await applied(movedToBeta)).toEqual(['applied']);
    expect(await rowsIn(database)).toEqual(before);
    expect(await playbooksIn(database)).toEqual([
      [{ playbook_key: 'playbook/acme/beta/' }, { playbook_key: 'playbook/acme/beta/' }],
      [{ playbook_key: 'playbook/acme/beta/' }],
      [{ playbook_key: 'playbook/acme/beta/' }],
    ]);
  });

  it('is unreadable on a stream of no definition', async () => {
    const { database } = await applying();
    const apply = definitionRecordsKeepingTheirOwnStops(database);

    expect(
      await Effect.runPromise(
        apply({ playbookKey: 'playbook/acme/alpha/', definitionKey: 'playbook/acme/alpha/' }, movedToBeta),
      ),
    ).toBe('unreadable');
  });
});
