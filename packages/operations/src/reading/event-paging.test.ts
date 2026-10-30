import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { changingNothing } from '../changes/change-naming.ts';
import { cursorOfParts, cursorWithin } from './cursor-parts.ts';
import { eventsPageOf, type EventPaging, type EventsPage } from './event-paging.ts';
import { nothingKept } from './kept-content.ts';
import { presentationOf, type Showing } from './presentation.ts';
import type { PresentedFact } from './presenter.ts';
import type { RecordedEvent, RecordedFact, RecordedPage } from './recorded-read.ts';

function recordOf(position: number, steps: number): RecordedEvent {
  return {
    id: `record-${position}`,
    cursor: cursorOfParts(['playbook/acme/alpha/', String(position)]),
    causationId: null,
    correlationId: null,
    stream: 'run-logs/r1',
    version: position,
    globalPosition: 1,
    context: { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    type: 'moved',
    data: { position, steps },
    recordedAt: '2026-10-05T09:00:00.000Z',
  };
}

const decodeMoved = Schema.decodeUnknownSync(Schema.Struct({ position: Schema.Number, steps: Schema.Number }));

function factOf(position: number, index: number): PresentedFact {
  const fact = { type: 'moved', summary: `Event ${index} of record ${position}.`, data: {} };
  return index === 0 ? fact : { ...fact, type: 'stepped', part: { number: index, causedBy: index - 1 } };
}

function eventsOf({ data }: RecordedFact): readonly PresentedFact[] {
  const { position, steps } = decodeMoved(data);
  return Array.from({ length: steps + 1 }, (_, index) => factOf(position, index));
}

const showing: Showing = {
  streamPrefix: 'playbook/acme/alpha/',
  content: nothingKept,
  view: 'page',
};

function pagingOf(paging: Omit<EventPaging, 'showing'>): EventPaging {
  return { ...paging, showing };
}

const presentation = presentationOf([
  {
    streamKind: 'run-logs',
    publicNames: { moved: ['moved', 'stepped'] },
    present: eventsOf,
    changes: changingNothing(['moved']),
  },
]);

function pageOf(records: readonly RecordedEvent[], nextCursor: string | null = null): RecordedPage {
  return { records, hasMore: nextCursor !== null, nextCursor, lastExamined: null };
}

function idsOf({ events }: EventsPage): readonly string[] {
  return events.map(({ id }) => id);
}

const first = recordOf(1, 2);

const second = recordOf(2, 1);

describe('a page of events', () => {
  it('answers every event of the records it read, in their order, with the cursor the read ended at', () => {
    const page = eventsPageOf(presentation, pageOf([first, second], 'later'), pagingOf({ order: 'asc', limit: 10 }));

    expect([idsOf(page), page.hasMore, page.nextCursor]).toEqual([
      ['record-1', 'record-1_1', 'record-1_2', 'record-2', 'record-2_1'],
      true,
      'later',
    ]);
    expect(page.events.map(({ metadata }) => metadata.stream)).toEqual(
      Array.from({ length: 5 }, () => 'playbook/acme/alpha/run-logs/r1'),
    );
  });

  it('ends inside a record when its limit falls there, with a cursor that reads on from the next event', () => {
    const page = eventsPageOf(presentation, pageOf([first, second]), pagingOf({ order: 'asc', limit: 2 }));
    const next = eventsPageOf(presentation, pageOf([first, second]), {
      order: 'asc',
      limit: 10,
      cursor: String(page.nextCursor),
      showing,
    });

    expect([idsOf(page), page.hasMore, page.nextCursor]).toEqual([
      ['record-1', 'record-1_1'],
      true,
      cursorWithin(first.cursor, 1),
    ]);
    expect(idsOf(next)).toEqual(['record-1_2', 'record-2', 'record-2_1']);
  });

  it('ends at the cursor of a record whose events it answered every one of', () => {
    const page = eventsPageOf(presentation, pageOf([first, second]), pagingOf({ order: 'asc', limit: 3 }));

    expect([idsOf(page), page.nextCursor]).toEqual([['record-1', 'record-1_1', 'record-1_2'], first.cursor]);
  });
});

describe('a page of events newest first, or of some of them', () => {
  it('answers each record backwards newest first, and reads on from inside it backwards too', () => {
    const page = eventsPageOf(presentation, pageOf([second, first]), pagingOf({ order: 'desc', limit: 4 }));
    const next = eventsPageOf(presentation, pageOf([first]), {
      order: 'desc',
      limit: 10,
      cursor: String(page.nextCursor),
      showing,
    });

    expect([idsOf(page), page.nextCursor]).toEqual([
      ['record-2_1', 'record-2', 'record-1_2', 'record-1_1'],
      cursorWithin(first.cursor, 1),
    ]);
    expect(idsOf(next)).toEqual(['record-1']);
  });

  it('skips nothing of a record a cursor does not point inside, and keeps only the events it is asked to', () => {
    const page = eventsPageOf(presentation, pageOf([second]), {
      order: 'asc',
      limit: 10,
      cursor: cursorWithin(first.cursor, 1),
      keeps: ({ type }) => type === 'stepped',
      showing,
    });

    expect(idsOf(page)).toEqual(['record-2_1']);
  });
});
