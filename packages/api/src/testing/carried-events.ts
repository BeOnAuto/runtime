import { createHmac } from 'node:crypto';

import type { EventDestination } from '@on.auto/providers';
import { tracker } from '@on.auto/providers/testing';

export const ticketOpened = {
  type: 'com.example.tracker.ticket.opened',
  title: 'A ticket is opened',
  subject: { title: 'Project', required: true },
  data: { type: 'object', properties: { title: { type: 'string' } } },
};

export const anOpenedTicket = {
  type: ticketOpened.type,
  when: { '$request.body#/action': ['opened'] },
  id: ['$request.body#/ticket/id'],
  subject: '$request.body#/ticket/project',
  data: { title: '$request.body#/ticket/title' },
  topic: '{{ subject }}',
};

export const boardsSecret = 'a secret the boards were given for webhook-21';

export const boardsHook = { topic: 'roadmap', id: 'webhook-21' };

const cardMoved = {
  type: 'org.example.boards.card.moved',
  title: 'A card is moved',
  subject: { title: 'Board', required: true },
  data: { type: 'object', properties: { lane: { type: 'string' }, labels: { type: 'array' } } },
};

const ofEachBoard = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.board }}',
  subscribe: {
    method: 'POST',
    url: 'https://api.boards.example.com/boards/{{ topic }}/webhooks',
    body: { callback: '{{ webhook_url }}', key: '{{ secret }}' },
    subscribed: { id: '/webhook/id' },
  },
  unsubscribe: { method: 'DELETE', url: 'https://api.boards.example.com/webhooks/{{ subscription.id }}' },
  verify: {
    scheme: 'hmac',
    secret: 'subscription',
    hash: 'sha512',
    signed_payload: '{payload}',
    signature: '$request.header.Boards-Signature',
    encoding: 'base64',
  },
  filter: { when: { '$request.body#/kind': ['note'] } },
  events: [
    {
      type: cardMoved.type,
      when: { '$request.body#/kind': ['card_moved'] },
      id: ['$request.body#/card/key', '$request.body#/move/seq'],
      time: '$request.body#/move/at',
      subject: '$request.body#/board/slug',
      data: { lane: '$request.body#/move/to', labels: '$request.body#/card/labels' },
      automatic: '$request.body#/move/by_app',
      topic: '{{ subject }}',
    },
  ],
};

export const boardsEntry = {
  ...tracker,
  name: 'boards',
  title: 'Boards',
  events: { types: [cardMoved], destinations: [ofEachBoard] },
};

export function boardHeaders(body: string, secret = boardsSecret): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    'boards-signature': createHmac('sha512', secret).update(body).digest('base64'),
  };
}

export function byATokenOf(destination: EventDestination): EventDestination {
  return {
    ...destination,
    verify: { scheme: 'bearer', secret: 'subscription', token: '$request.header.Boards-Token' },
  };
}

export function tokenHeaders(secret = boardsSecret): Readonly<Record<string, string>> {
  return { 'content-type': 'application/json', 'boards-token': secret };
}
