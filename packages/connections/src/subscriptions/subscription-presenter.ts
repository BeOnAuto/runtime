import { changingEvents, strictRecordedDecoder, type PresentedFact, type Presenter } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import type { SubscriptionFailureKind } from '@on.auto/providers';

import {
  EventSubscriptionEventSchema,
  eventSubscriptionsKind,
  eventSubscriptionTypes,
  type RecordedEventSubscriptionEvent,
} from './subscription-facts.ts';

const subscriptionEventOf = strictRecordedDecoder(EventSubscriptionEventSchema);

const failedWords: Readonly<Record<SubscriptionFailureKind, string>> = {
  connection_broken: 'the connection is not connected',
  scope_lacking: 'the connection lacks the access this takes',
  tool_error: 'the call failed, or its answer could not be read',
  unreachable: 'the service did not take the call just now, and the playbook tries again',
  not_sent: 'the call was not made',
};

function atTheServiceOf(connection: string, topic: string): string {
  return `at the service of the connection ${quoted(connection)} to ${quoted(topic)}`;
}

function presentedOf(event: RecordedEventSubscriptionEvent): PresentedFact {
  const { connection, topic } = event.data;
  const key = { connection, topic };
  const where = atTheServiceOf(connection, topic);
  if (event.type === 'event_subscription_made') {
    return {
      type: event.type,
      summary: `The playbook subscribed ${where}, so the service tells it when something changes there.`,
      data: key,
    };
  }
  if (event.type === 'event_subscription_failed') {
    const { kind, because } = event.data;
    return {
      type: event.type,
      summary: `The playbook's subscription ${where} failed: ${failedWords[kind]}. Where a function reads replies there, the playbook still looks for them itself, so an answer may be taken later.`,
      data: { ...key, kind, because },
    };
  }
  return {
    type: event.type,
    summary: `The playbook no longer holds its subscription ${where}.`,
    data: key,
  };
}

export const eventSubscriptionPresenter: Presenter = {
  streamKind: eventSubscriptionsKind,
  publicNames: Object.fromEntries(eventSubscriptionTypes.map((type) => [type, [type]])),
  present: (recorded) => [presentedOf(subscriptionEventOf(recorded))],
  changes: changingEvents(eventSubscriptionTypes),
};
