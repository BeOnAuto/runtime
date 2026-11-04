import type { Trigger } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { about, applying, first, retired, row, rowsIn, saved } from '../reaction-testing/applied-records.ts';
import { pausesOf } from '../reaction-testing/kept-triggers.ts';
import { eventTrigger, everyTrigger } from '../reaction-testing/playbook-writes.ts';
import type { DefinitionRecord } from './definition-records.ts';

const aMinute = 60_000;

const restoredAt = first + 50 * aMinute;

const resumedAt = first + 60 * aMinute;

function restored(id: string, name: string, triggers: readonly Trigger[], at: number): DefinitionRecord {
  return {
    id,
    type: 'definition_restored',
    data: { content: { source: 'schedule: {}', triggers }, restored_by: { id: 'acme-admin', name: 'acme-admin' } },
    context: about(name, 1, new Date(at).toISOString()),
  };
}

function resumed(id: string, name: string, at: number): DefinitionRecord {
  return { id, type: 'definition_resumed', data: {}, context: about(name, 1, new Date(at).toISOString()) };
}

describe('a retirement and a restoration of a workflow with triggers', () => {
  it('bring the rows of its triggers back paused, a schedule with no next due time until a resumption sets its first time after it', async () => {
    const { database, applied } = await applying();
    const triggers = [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(15 * aMinute)];
    await applied(saved({ id: 's1', name: 'close', version: 1, triggers }), retired('r1', 'close'));
    const whileRetired = [await rowsIn(database), await pausesOf(database)];

    await applied(restored('b1', 'close', triggers, restoredAt));
    const onceRestored = [await rowsIn(database), await pausesOf(database)];
    await applied(resumed('u1', 'close', resumedAt));

    expect(whileRetired).toEqual([[], []]);
    expect(onceRestored).toEqual([
      [
        row({ reference: '/schedule/every', version: 1, kind: 'every', by: 'b1', at: restoredAt, due: null }),
        row({ reference: '/schedule/on', version: 1, kind: 'event', by: 'b1', at: restoredAt, due: null }),
      ],
      ['close'],
    ]);
    expect([await rowsIn(database), await pausesOf(database)]).toEqual([
      [
        row({
          reference: '/schedule/every',
          version: 1,
          kind: 'every',
          by: 'b1',
          at: restoredAt,
          due: restoredAt + 15 * aMinute,
        }),
        row({ reference: '/schedule/on', version: 1, kind: 'event', by: 'b1', at: restoredAt, due: null }),
      ],
      [],
    ]);
  });
});
