import { changingEvents, type Presenter } from '@on.auto/operations';

import { EventPublishedSchema, type RecordedEventPublished } from '../events/published-events.ts';
import { eventEmitted, eventPublished } from '../plain-language/event-words.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function summaryOf(type: string, context: RecordedEventPublished['context']): string {
  return context.runId === undefined
    ? eventPublished(type)
    : eventEmitted(type, cutAtCodePoint(context.definitionName, mostNameBytes));
}

function accountOf({ data, context }: RecordedEventPublished): Account {
  const { event, filled } = data;
  const type = cutAtCodePoint(event.type, mostNameBytes);
  return {
    summary: summaryOf(type, context),
    data: {
      event_id: cutAtCodePoint(event.id, mostNameBytes),
      event_type: type,
      source: cutAtCodePoint(event.source, mostDetailBytes),
      ...(event.subject === undefined ? {} : { subject: cutAtCodePoint(event.subject, mostDetailBytes) }),
      time: event.time,
      ...(event.data === undefined ? {} : { data: event.data }),
      filled,
    },
  };
}

export const publishedEventPresenter: Presenter = eventPresenter<RecordedEventPublished>({
  streamKind: 'events',
  eventSchema: EventPublishedSchema,
  types: ['event_published'],
  account: accountOf,
  changes: changingEvents(['event_published']),
});
