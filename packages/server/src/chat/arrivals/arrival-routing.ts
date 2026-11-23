import type { ChatMessage } from '@on.auto/providers';

import type { ChatStore } from '../store/chat-store.ts';
import type { Arrival } from '../tables/chat-rows.ts';
import { AMBIENT, MENTION, placeOf, type ChatConnection, type Claimed, type Routed } from './arrival-parts.ts';

function rootRepliedTo({ id, thread }: Pick<ChatMessage, 'id' | 'thread'>): string | undefined {
  return thread === id ? undefined : thread;
}

async function ambientRouteOf(message: ChatMessage, connection: ChatConnection, store: ChatStore): Promise<Routed> {
  if (rootRepliedTo(message) === undefined) {
    return 'passed';
  }
  const conversation = await store.conversations.found(placeOf(connection, message));
  return conversation !== undefined && (await store.conversations.spokenIn(conversation, message.sender))
    ? 'ambient'
    : 'passed';
}

export async function routeOf(message: ChatMessage, connection: ChatConnection, store: ChatStore): Promise<Routed> {
  if (message.account !== connection.account || message.text.trim() === '') {
    return 'passed';
  }
  const root = rootRepliedTo(message);
  if (root !== undefined && (await connection.requestSentAs(message.conversation, root))) {
    return 'passed';
  }
  return message.kind === AMBIENT ? ambientRouteOf(message, connection, store) : 'person';
}

export async function claimOf(arrival: Arrival, store: ChatStore): Promise<Claimed> {
  if (await store.arrivals.claimed(arrival)) {
    return 'run';
  }
  if (arrival.kind !== MENTION) {
    return 'dropped';
  }
  return (await store.arrivals.outranked(arrival, AMBIENT)) === 'taken' ? 'run' : 'dropped';
}
