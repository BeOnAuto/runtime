import type { ProviderEntry } from '@on.auto/providers';
import { cardMoved, ofEachSubscription, ofTheApp, providersOf, trackerOverASocket } from '@on.auto/providers/testing';
import { Array as Arr, Option } from 'effect';

import type { AppCredentialHeld } from '../registry/connection.ts';
import type { EventsReceived } from '../triggers/connection-hearing.ts';

export const placedCard = {
  ...cardMoved,
  subject: { title: 'Board', required: true, description: 'The board’s key, as the boards show it' },
};

export const archived = {
  type: 'com.example.boards.card.archived',
  title: 'A card is archived',
  data: { type: 'object' },
};

const mappedOverHttp = {
  type: cardMoved.type,
  when: { '$request.body#/kind': ['card'] },
  id: ['$request.body#/board', '$request.body#/card/serial'],
  subject: '$request.body#/board',
  data: { column: '$request.body#/card/column' },
};

export const bySubscription = { ...ofEachSubscription, events: [{ ...mappedOverHttp, topic: '{{ subject }}' }] };

export const bySubscriptionOfWhoMoved = {
  ...ofEachSubscription,
  events: [{ ...mappedOverHttp, topic: '{{ subject }}', actor: '$request.body#/card/mover' }],
};

const archivedOverHttp = {
  type: archived.type,
  when: { '$request.body#/kind': ['archived'] },
  id: ['$request.body#/card/serial'],
  data: {},
};

export const byTheApp = { ...ofTheApp, events: [mappedOverHttp, archivedOverHttp] };

export const byChecking = {
  type: 'polling',
  read: {
    tool: 'list_cards',
    with: { board: '{{ topic }}', after: '{{ since }}' },
    list: '/cards',
    order: 'oldest_first',
    cursor: '/moved_at',
  },
  read_limit: { quota: 30, window_seconds: 3600 },
  events: [
    {
      type: cardMoved.type,
      when: {},
      id: ['$message.payload#/board', '$message.payload#/serial'],
      subject: '$message.payload#/board',
      data: { column: '$message.payload#/column' },
      topic: '{{ subject }}',
    },
  ],
};

export const boardsIdentity = { tool: 'whoami', identified: { id: '/self/uid' } };

export function boardsEntryOf(
  destinations: readonly object[],
  identity?: object,
  types: readonly object[] = [placedCard, archived],
): object {
  return {
    ...trackerOverASocket,
    name: 'boards',
    events: {
      types,
      ...(identity === undefined ? {} : { identity }),
      destinations,
    },
  };
}

export function boardsSentBy(...destinations: readonly object[]): ProviderEntry {
  return Option.getOrThrow(Arr.head(providersOf(boardsEntryOf(destinations)).providers)).entry;
}

export const theServerWithAnAddress: EventsReceived = { perSubscription: true, perApp: false, socket: true };

export const theServerWithNoAddress: EventsReceived = { perSubscription: false, perApp: false, socket: true };

export const autoCloud: EventsReceived = { perSubscription: true, perApp: true, socket: false };

export const heldUnrefused: readonly AppCredentialHeld[] = [{ name: 'app_level_token', refused: null }];

export const heldRefused: readonly AppCredentialHeld[] = [
  { name: 'app_level_token', refused: { detail: 'Refused', at: '2026-11-22T09:00:00.000Z' } },
];

export const noneHeld: readonly AppCredentialHeld[] = [];
