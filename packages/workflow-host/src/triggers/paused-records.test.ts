import type { Statement } from '@on.auto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
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
import { pausesOf } from '../reaction-testing/kept-triggers.ts';
import { cronTrigger, eventTrigger, everyTrigger } from '../reaction-testing/playbook-writes.ts';
import type { DefinitionRecord } from './definition-records.ts';

const aMinute = 60_000;

const nineTomorrow = Date.parse('2026-10-02T09:00:00.000Z');

function standingChanged(id: string, type: 'definition_paused' | 'definition_resumed', at: number): DefinitionRecord {
  const data = type === 'definition_paused' ? { paused_by: { id: 'acme-admin', name: 'acme-admin' } } : {};
  return { id, type, data, context: about('close', 1, new Date(at).toISOString()) };
}

describe('a pause and a resumption of a workflow with triggers', () => {
  it('keep the rows of its triggers, a schedule with no next due time while it is paused and its first time after the resumption once resumed', async () => {
    const { database, applied } = await applying();
    const triggers = [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(15 * aMinute)];
    await applied(saved({ id: 's1', name: 'close', version: 1, triggers }));

    await applied(standingChanged('p1', 'definition_paused', first + 20 * aMinute));
    const paused = await rowsIn(database);
    await applied(standingChanged('r1', 'definition_resumed', first + 50 * aMinute));

    expect(paused.map(({ reference, next_due: due }) => [reference, due])).toEqual([
      ['/schedule/every', null],
      ['/schedule/on', null],
    ]);
    expect(await rowsIn(database)).toEqual([
      row({ reference: '/schedule/every', version: 1, kind: 'every', by: 's1', at: first, due: first + 60 * aMinute }),
      row({ reference: '/schedule/on', version: 1, kind: 'event', by: 's1', at: first, due: null }),
    ]);
  });

  it('activate a version saved while it is paused with no next due time, which the resumption sets from its anchor', async () => {
    const { database, applied } = await applying();
    await applied(
      saved({ id: 's1', name: 'close', version: 1, triggers: [everyTrigger(aMinute)] }),
      standingChanged('p1', 'definition_paused', first + 5 * aMinute),
      saved({ id: 's2', name: 'close', version: 2, triggers: [cronTrigger('0 9 * * *')], at: first + 6 * aMinute }),
    );
    const paused = await rowsIn(database);

    await applied(standingChanged('r1', 'definition_resumed', nineTomorrow + aMinute));

    expect(paused.map(({ reference, next_due: due }) => [reference, due])).toEqual([['/schedule/cron', null]]);
    expect((await rowsIn(database)).map(({ reference, next_due: due }) => [reference, due])).toEqual([
      ['/schedule/cron', nineTomorrow + 24 * 60 * aMinute],
    ]);
  });
});

function setsANextDueTime({ strings }: Statement): boolean {
  return strings.some((part) => part.endsWith('SET next_due = '));
}

function failingOnceAtTheResumption(database: HostDatabase): HostDatabase {
  const failures = { left: 1 };
  const failedOnce = (
    statements: readonly Statement[],
    otherwise: () => Effect.Effect<readonly unknown[], DatabaseFailed>,
  ) =>
    Effect.suspend(() => {
      if (failures.left > 0 && statements.some((written) => setsANextDueTime(written))) {
        failures.left -= 1;
        return Effect.fail(new DatabaseFailed({ detail: 'The database was told to fail' }));
      }
      return otherwise();
    });
  return {
    ...database,
    write: (written) => failedOnce([written], () => database.write(written)),
    transaction: (written) => failedOnce(written, () => database.transaction(written)),
  };
}

describe('a resumption the database fails to write', () => {
  it('leaves the workflow paused, so that applied again it gives each schedule its first time after the resumption', async () => {
    const { database, applied } = await applying(failingOnceAtTheResumption);
    await applied(
      saved({ id: 's1', name: 'close', version: 1, triggers: [everyTrigger(aMinute)] }),
      standingChanged('p1', 'definition_paused', first + 5 * aMinute),
    );
    const resumed = standingChanged('r1', 'definition_resumed', first + 10 * aMinute);

    const failed = await Effect.runPromiseExit(Effect.promise(() => applied(resumed)));
    const meanwhile = [await rowsIn(database), await pausesOf(database)];
    await applied(resumed);

    expect(Exit.isFailure(failed)).toBe(true);
    expect(meanwhile).toEqual([
      [row({ reference: '/schedule/every', version: 1, kind: 'every', by: 's1', at: first, due: null })],
      ['close'],
    ]);
    expect([await rowsIn(database), await pausesOf(database)]).toEqual([
      [
        row({
          reference: '/schedule/every',
          version: 1,
          kind: 'every',
          by: 's1',
          at: first,
          due: first + 11 * aMinute,
        }),
      ],
      [],
    ]);
  });
});

describe('a pause and a resumption applied again, as a pass that reads them again does', () => {
  it('change nothing', async () => {
    const { database, applied } = await applying();
    await applied(
      saved({ id: 's1', name: 'close', version: 1, triggers: [everyTrigger(aMinute)] }),
      standingChanged('p1', 'definition_paused', first + 5 * aMinute),
      standingChanged('r1', 'definition_resumed', first + 10 * aMinute),
    );
    await runningSet(database, '/schedule/every', 'run-1');
    const once = await rowsIn(database);

    await applied(standingChanged('r1', 'definition_resumed', first + 10 * aMinute));

    expect(await rowsIn(database)).toEqual(once);
  });
});

describe('a pause of a workflow with triggers', () => {
  it('outlasts a version without triggers, and is forgotten with the retirement', async () => {
    const { database, applied } = await applying();
    await applied(
      saved({ id: 's1', name: 'close', version: 1, triggers: [everyTrigger(aMinute)] }),
      standingChanged('p1', 'definition_paused', first + 5 * aMinute),
      saved({ id: 's2', name: 'close', version: 2, triggers: [], at: first + 6 * aMinute }),
      saved({ id: 's3', name: 'close', version: 3, triggers: [everyTrigger(aMinute)], at: first + 7 * aMinute }),
    );
    const stillPaused = await rowsIn(database);

    await applied(retired('s4', 'close'));

    expect(stillPaused.map(({ version, next_due: due }) => [version, due])).toEqual([[3, null]]);
    expect([await rowsIn(database), await pausesOf(database)]).toEqual([[], []]);
  });
});
