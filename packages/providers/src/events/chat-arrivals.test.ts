import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { aMention, chatOverASocket, overASocketWithAChat } from '../testing/chat-destinations.ts';
import { without } from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import type { Arrival } from './arrival-readings.ts';
import { chatMessageIn, type ChatMessage } from './chat-arrivals.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

function declaring(destination: object): (arrival: Arrival) => ChatMessage | undefined {
  const entry = { ...chatOverASocket, events: { destinations: [destination] } };
  const read = eventDestinationOf(providersOf(entry), 'tracker', 'websocket');
  return (arrival) => (read === undefined ? undefined : chatMessageIn(read, arrival));
}

const readByTheChat = declaring(overASocketWithAChat);

const aMessage: Fields = {
  id: 'm2',
  room: 'r1',
  thread: 'm1',
  author: 'ada',
  text: 'how are the sales?',
  sent_at: 1_700_000_000,
};

function payloadOf(kind: string, room: Fields, message: Fields, left: readonly string[]): Fields {
  const written = Object.fromEntries(
    Object.entries({ ...aMessage, ...message }).filter(([key]: readonly [string, Schema.Json]) => !left.includes(key)),
  );
  return { kind, space: 's1', room: { shared: false, ...room }, message: written };
}

function arriving(kind: string, room: Fields, message: Fields = {}, ...left: readonly string[]): Arrival {
  return { transport: 'message', payload: payloadOf(kind, room, message, left) };
}

function accountOf(message: Fields, space: Fields): string | undefined {
  const payload = { kind: 'mention', room: { kind: 'open' }, message: { ...aMessage, ...message }, ...space };
  return readByTheChat({ transport: 'message', payload })?.account;
}

function sharedIn(room: Fields): boolean | undefined {
  return readByTheChat(arriving('mention', { kind: 'open', ...room }))?.shared;
}

const read = {
  id: 'm2',
  conversation: 'r1',
  thread: 'm1',
  sender: 'ada',
  account: 's1',
  text: 'how are the sales?',
  time: '2023-11-14T22:13:20Z',
  shared: false,
};

describe('a message a person wrote where the app reads', () => {
  it.each([
    ['a mention', arriving('mention', { kind: 'open' }), 'mention'],
    ['a direct message', arriving('message', { kind: 'direct' }), 'direct_message'],
    ['a reply in a thread the app reads that does not name it', arriving('message', { kind: 'private' }), 'ambient'],
  ])('is read as %s, with each place declared', (_, arrival, kind) => {
    expect(readByTheChat(arrival)).toEqual({ kind, ...read });
  });

  it('is read in a conversation of its own, outside a thread, where it names the app or is written to it alone', () => {
    expect([
      readByTheChat(arriving('mention', { kind: 'open' }, {}, 'thread'))?.kind,
      readByTheChat(arriving('message', { kind: 'direct' }, {}, 'thread', 'sent_at'))?.kind,
      readByTheChat(arriving('message', { kind: 'direct' }, {}, 'thread', 'sent_at'))?.time,
    ]).toEqual(['mention', 'direct_message', undefined]);
  });

  it('names the account of whoever wrote it by the first place that holds one, and none where none does', () => {
    expect([
      accountOf({ author_space: 's2' }, { space: 's1' }),
      accountOf({}, { space: 's1' }),
      accountOf({}, {}),
    ]).toEqual(['s2', 's1', undefined]);
  });

  it('says the conversation is shared unless the place says false, and not shared where no place is declared', () => {
    const undeclared = declaring({ ...overASocketWithAChat, chat: [without(aMention, 'shared')] });

    expect([
      sharedIn({ shared: false }),
      sharedIn({ shared: true }),
      sharedIn({ shared: null }),
      undeclared(arriving('mention', { kind: 'open', shared: true }))?.shared,
    ]).toEqual([false, true, true, false]);
  });
});

describe('an arrival that says nothing of a message a person wrote', () => {
  it.each([
    ['written by an app', arriving('mention', { kind: 'open' }, { app: 'a1' })],
    ['an edit', arriving('message', { kind: 'direct' }, { state: 'edited' })],
    ['a deletion', arriving('mention', { kind: 'open' }, { state: 'deleted' })],
    ['in a conversation of another kind', arriving('message', { kind: 'group' })],
    ['of no declared kind', arriving('reaction', { kind: 'open' })],
    ['in a channel, outside a thread, naming no app', arriving('message', { kind: 'open' }, {}, 'thread')],
    ['the first message of its thread, naming no app', arriving('message', { kind: 'open' }, { thread: 'm2' })],
    ['without its ID', arriving('mention', { kind: 'open' }, {}, 'id')],
    ['without its conversation', arriving('mention', { kind: 'open' }, {}, 'room')],
    ['without who wrote it', arriving('mention', { kind: 'open' }, { author: '' })],
    ['without words', arriving('mention', { kind: 'open' }, { text: 7 })],
  ])('is none where it is %s', (_, arrival) => {
    expect(readByTheChat(arrival)).toBeUndefined();
  });

  it('is none where the destination says nothing of the messages a person writes', () => {
    expect(declaring(without(overASocketWithAChat, 'chat'))(arriving('mention', { kind: 'open' }))).toBeUndefined();
  });
});
