import type { ProjectedKeyedRow, ProjectedRowsQuery, RowsAddress } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { aReader, executedIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { definitionFactTypes, type DefinitionContent } from '../registry/definition-events.ts';
import type { Trigger, TriggerFilter } from '../registry/definition-triggers.ts';
import {
  changesConnectionTriggers,
  connectionTriggerFacts,
  connectionTriggersOf,
  savedTriggersOf,
} from './connection-triggers.ts';
import { pointerDisagrees } from './read-model-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const posted = 'com.example.chat.post';

function filterOf(reference: string, attributes: Readonly<Record<string, string>>) {
  return { reference, type: posted, attributes: { type: posted, ...attributes } };
}

const listening: readonly Trigger[] = [
  {
    kind: 'event',
    reference: '/schedule/on',
    filters: [
      filterOf('/schedule/on/any/0', { source: '/connections/tracker', subject: 'site' }),
      filterOf('/schedule/on/any/1', { source: '/connections/chat' }),
      filterOf('/schedule/on/any/2', { source: '/runs/run-1', subject: 'site' }),
      filterOf('/schedule/on/any/3', { subject: 'site' }),
    ],
  },
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1' },
];

const listingBookings = { tool: 'list_bookings', list: '/bookings', order: 'oldest_first', id: ['/id'] } as const;

const readingBookings: readonly Trigger[] = [
  {
    kind: 'event',
    reference: '/schedule/on',
    filters: [
      {
        reference: '/schedule/on/one',
        type: 'booking.created',
        attributes: { type: 'booking.created', source: '/connections/bookings' },
        read: listingBookings,
      },
    ],
  },
];

const fromTheTracker: readonly Trigger[] = [
  {
    kind: 'event',
    reference: '/schedule/on',
    filters: [filterOf('/schedule/on/one', { source: '/connections/tracker' })],
  },
];

function aLedger(): MemoryLedger {
  return readModelLedgerOf(['echo', 'workflow']);
}

interface Placed {
  readonly type?: string;
  readonly playbook?: string;
}

function created(ledger: MemoryLedger, name: string, triggers?: readonly Trigger[], placed: Placed = {}) {
  const { type = 'workflow', playbook = 'alpha' } = placed;
  const content = triggers === undefined ? { source: name } : { source: name, triggers };
  const creation = { type: 'create', name, content, created_by: aReader, definition_id: `${name}-id` } as const;
  return executedIn(ledger.service, type, creation, playbook);
}

function triggersIn(ledger: MemoryLedger) {
  return Effect.runPromise(connectionTriggersOf(ledger.service, alpha));
}

describe('the triggers of a playbook that name a connection', () => {
  it('are each filter of an active workflow of the playbook whose source names a connection, with its type and subject', async () => {
    const ledger = aLedger();
    await created(ledger, 'triage', listening);
    await created(ledger, 'quiet');
    await created(ledger, 'greeter', listening, { type: 'echo' });
    await created(ledger, 'elsewhere', listening, { playbook: 'beta' });

    expect(await triggersIn(ledger)).toEqual([
      { connection: 'tracker', type: posted, subject: 'site' },
      { connection: 'chat', type: posted },
    ]);
  });

  it('carry the read a filter names', async () => {
    const ledger = aLedger();
    await created(ledger, 'bookings', readingBookings);

    expect(await triggersIn(ledger)).toEqual([
      { connection: 'bookings', type: 'booking.created', read: listingBookings },
    ]);
  });

  it('are none while the workflow is paused, retired or saved again without them, and back once it is active with them', async () => {
    const ledger = aLedger();
    await created(ledger, 'triage', fromTheTracker);
    const read: (readonly unknown[])[] = [];
    const after = async (command: Parameters<typeof executedIn>[2]) => {
      await executedIn(ledger.service, 'workflow', command);
      read.push(await triggersIn(ledger));
    };
    await after({ type: 'pause', name: 'triage', paused_by: aReader });
    await after({ type: 'resume', name: 'triage' });
    await after({ type: 'retire', name: 'triage' });
    await after({ type: 'restore', name: 'triage', restored_by: aReader });
    await after({ type: 'resume', name: 'triage' });
    await after({ type: 'update', name: 'triage', content: { source: 'triage, version 2' } });

    const tracker = [{ connection: 'tracker', type: posted }];
    expect(read).toEqual([[], tracker, [], [], tracker, []]);
  });
});

const namesTheTracker = (filter: TriggerFilter) => filter.attributes['source'] === '/connections/tracker';

const totals = {
  reference: '/schedule/on/any/0',
  type: posted,
  attributes: { type: posted, source: '/connections/tracker', data: '${ $data.total as number > 1 }' },
};

const savedToRun: DefinitionContent = {
  source: 'totals',
  triggers: [
    { kind: 'event', reference: '/schedule/on', filters: [totals] },
    {
      kind: 'event',
      reference: '/schedule/on/chat',
      filters: [filterOf('/schedule/on/chat/0', { source: '/connections/chat' })],
    },
    { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1' },
  ],
  stripped: { expressions: { ' $data.total as number > 1 ': ' $data.total           > 1 ' } },
};

function savedIn(ledger: Pick<MemoryLedger, 'service'>) {
  return Effect.runPromise(savedTriggersOf(ledger.service)(alpha, namesTheTracker));
}

describe('the saved triggers of a playbook that a filter chosen names', () => {
  it('are the event triggers of its active workflows with such a filter, in the forms their save keeps to run', async () => {
    const ledger = aLedger();
    const creation = { type: 'create', name: 'totals', content: savedToRun, created_by: aReader } as const;
    await executedIn(ledger.service, 'workflow', { ...creation, definition_id: 'totals-id' });
    await created(ledger, 'quiet');
    await created(ledger, 'greeter', fromTheTracker, { type: 'echo' });
    await created(ledger, 'elsewhere', fromTheTracker, { playbook: 'beta' });
    await created(ledger, 'resting', fromTheTracker);
    await executedIn(ledger.service, 'workflow', { type: 'pause', name: 'resting', paused_by: aReader });

    expect(await savedIn(ledger)).toEqual([
      {
        definition: 'totals-id',
        reference: '/schedule/on',
        filters: [{ ...totals, attributes: { ...totals.attributes, data: '${ $data.total           > 1 }' } }],
      },
    ]);
  });

  it('are none of a row that names no definition, and refused where a row names no save of its version', async () => {
    const ledger = aLedger();
    await created(ledger, 'triage', fromTheTracker);
    const rowsAltered = (alter: (row: ProjectedKeyedRow) => ProjectedKeyedRow) => ({
      service: {
        ...ledger.service,
        readProjectedRows: (projection: string, address: RowsAddress, query: ProjectedRowsQuery) =>
          Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
            rows.map((row) => alter(row)),
          ),
      },
    });

    const unplaced = await savedIn(rowsAltered((row) => Struct.omit(row, ['definition'])));
    const moved = rowsAltered((row) => ({ ...row, row: { ...row.row, version: 2 } }));

    expect(unplaced).toEqual([]);
    expect(await Effect.runPromise(Effect.flip(savedTriggersOf(moved.service)(alpha, namesTheTracker)))).toEqual(
      pointerDisagrees,
    );
  });
});

function changedByA(definitionType: string, types: readonly string[]): readonly string[] {
  return types.filter((type) => changesConnectionTriggers({ type, context: { definitionType } }));
}

describe('the facts after which what a playbook’s triggers name may change', () => {
  it('are the facts of a workflow’s definition that save, pause, resume, retire, restore or move it, and no fact of another type', () => {
    expect(changedByA('workflow', definitionFactTypes)).toEqual(connectionTriggerFacts);
    expect(changedByA('echo', [...definitionFactTypes, 'run_succeeded'])).toEqual([]);
    expect(changesConnectionTriggers({ type: 'definition_updated', context: {} })).toBe(false);
  });
});
