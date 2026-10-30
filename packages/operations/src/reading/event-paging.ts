import { cursorWithin, insideOf, type InsideARecord } from './cursor-parts.ts';
import type { Presentation, Showing } from './presentation.ts';
import type { PublicEvent } from './public-event.ts';
import type { RecordedEvent, RecordedOrder, RecordedPage } from './recorded-read.ts';

export interface EventPaging {
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly cursor?: string;
  readonly keeps?: (event: PublicEvent) => boolean;
  readonly showing: Showing;
}

export interface EventsPage {
  readonly events: readonly PublicEvent[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

interface Shown {
  readonly recorded: RecordedEvent;
  readonly index: number;
  readonly event: PublicEvent;
}

function keepingAll(): boolean {
  return true;
}

function answeredBefore(order: RecordedOrder, inside: InsideARecord | undefined, { recorded, index }: Shown): boolean {
  if (inside === undefined || inside.record !== recorded.cursor) {
    return false;
  }
  return order === 'asc' ? index <= inside.index : index >= inside.index;
}

function shownOf(presentation: Presentation, paging: EventPaging): (recorded: RecordedEvent) => readonly Shown[] {
  const inside = insideOf(paging.cursor);
  const keeps = paging.keeps ?? keepingAll;
  return (recorded) => {
    const shown = presentation
      .present(recorded, paging.showing)
      .map((event, index): Shown => ({ recorded, index, event }))
      .filter((each) => keeps(each.event) && !answeredBefore(paging.order, inside, each));
    return paging.order === 'asc' ? shown : shown.toReversed();
  };
}

function eventOf({ event }: Shown): PublicEvent {
  return event;
}

function cursorAfter(last: Shown, next: Shown): string {
  return next.recorded === last.recorded ? cursorWithin(last.recorded.cursor, last.index) : last.recorded.cursor;
}

export function eventsPageOf(presentation: Presentation, page: RecordedPage, paging: EventPaging): EventsPage {
  const shown = page.records.flatMap(shownOf(presentation, paging));
  const answered = shown.slice(0, paging.limit);
  const events = answered.map((each) => eventOf(each));
  const last = answered.at(-1);
  const next = shown[paging.limit];
  if (last === undefined || next === undefined) {
    return { events, hasMore: page.hasMore, nextCursor: page.nextCursor };
  }
  return { events, hasMore: true, nextCursor: cursorAfter(last, next) };
}
