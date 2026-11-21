import { playbookCallerOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostPublishedEventBytes } from './cloud-event.ts';
import {
  connectionEventRecorder,
  connectionPublicationOf,
  type ConnectionPublication,
  type ReportedEvent,
} from './connection-events.ts';
import { publishedEventOf } from './published-events.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const reported: ReportedEvent = {
  type: 'com.example.ticket.opened',
  id: 'T-1',
  subject: 'board-7',
  data: { title: 'Broken' },
};

const takenAt = '2026-11-20T09:00:00.000Z';

const ofTickets = '/connections/tickets';

function publicationOf(event: ReportedEvent): ConnectionPublication {
  const publication = connectionPublicationOf('tickets', event, takenAt);
  if (publication === undefined) throw new Error('The playbook records no such event');
  return publication;
}

describe('an event a connection reports, as the playbook records it', () => {
  it('is a CloudEvent of the connection’s source, its time the one given or filled, its subject and mark only where given', () => {
    const at = '2026-11-20T08:59:00Z';

    expect([
      publicationOf({ ...reported, time: at, automatic: true }),
      publicationOf({ type: reported.type, id: 'T-2', data: {}, automatic: false }),
    ]).toEqual([
      { event: { specversion: '1.0', ...reported, source: ofTickets, time: at, automatic: true }, filled: [] },
      {
        event: { specversion: '1.0', id: 'T-2', source: ofTickets, type: reported.type, time: takenAt, data: {} },
        filled: ['time'],
      },
    ]);
  });

  it('is none where it breaks the rules of an event or takes more bytes than the playbook records', () => {
    const tooLarge = { title: 'x'.repeat(mostPublishedEventBytes) };

    expect([
      connectionPublicationOf('tickets', { ...reported, id: 'x'.repeat(257) }, takenAt),
      connectionPublicationOf('tickets', { ...reported, data: tooLarge }, takenAt),
    ]).toEqual([undefined, undefined]);
  });
});

describe('an event a connection reports, recorded on the ledger', () => {
  it('is recorded once as the playbook, and nothing is recorded for its source and id again', async () => {
    const ledger = memoryLedger();
    const record = connectionEventRecorder(ledger.service);
    const later = publicationOf({ ...reported, data: { title: 'Fixed' } });

    await Effect.runPromise(
      Effect.all([record(alpha, publicationOf(reported), takenAt), record(alpha, later, '2026-11-20T09:00:01.000Z')]),
    );
    const read = ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 10 });

    expect((await Effect.runPromise(read)).records.map((recorded) => publishedEventOf(recorded))).toEqual([
      {
        type: 'event_published',
        data: publicationOf(reported),
        context: { at: takenAt, by: playbookCallerOf(alpha).id },
      },
    ]);
  });
});
