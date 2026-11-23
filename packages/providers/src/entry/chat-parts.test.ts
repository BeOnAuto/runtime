import { describe, expect, it } from 'vitest';

import { aChat, aMention, chatKinds, chatOverASocket, overASocketWithAChat } from '../testing/chat-destinations.ts';
import { decodedEntry, problemsOf } from '../testing/entry-problems.ts';
import { without } from '../testing/event-destinations.ts';

function pathsRefused(entry: unknown): readonly string[] {
  return problemsOf(entry).map(([path]) => path);
}

function chatWith(part: string, written: unknown): Readonly<Record<string, unknown>> {
  return { ...chatOverASocket, chat: { ...aChat, [part]: written } };
}

function sentBy(destination: object): Readonly<Record<string, unknown>> {
  return { ...chatOverASocket, events: { destinations: [destination] } };
}

const others = chatKinds.slice(1);

describe('the chat of an entry', () => {
  it('is taken with how Auto answers, reads a thread and reads a person, with or without a line only one person sees', () => {
    expect([
      pathsRefused(chatOverASocket),
      pathsRefused({ ...chatOverASocket, chat: without(aChat, 'ephemeral') }),
    ]).toEqual([[], []]);
    expect(decodedEntry(chatOverASocket).chat).toEqual(aChat);
  });

  it('is taken reading a person by the address and the name alone, where the service says nothing more of them', () => {
    const bare = { ...aChat, sender: without(aChat.sender, 'email_verified', 'account', 'active') };

    expect(pathsRefused({ ...chatOverASocket, chat: bare })).toEqual([]);
  });

  it('is needed beside a destination that says which messages a person wrote, and is taken where none says so', () => {
    expect([
      pathsRefused(without(chatOverASocket, 'chat')),
      pathsRefused({ ...without(chatOverASocket, 'events'), chat: aChat }),
    ]).toEqual([['/events/destinations/0/chat'], []]);
  });
});

const refusedParts = [
  ['a tool that is no tool name', 'answer', { ...aChat.answer, tool: 'post message' }, '/chat/answer/tool'],
  [
    'a pointer to the message posted that is no pointer',
    'answer',
    { ...aChat.answer, sent: 'id' },
    '/chat/answer/sent',
  ],
  [
    'an argument that reads what a chat does not have',
    'answer',
    { ...aChat.answer, replace: { ...aChat.answer.replace, with: { text: '{{ input.note }}' } } },
    '/chat/answer/replace/with/text',
  ],
  [
    'a line only one person sees with no tool name',
    'ephemeral',
    { ...aChat.ephemeral, tool: 'a line' },
    '/chat/ephemeral/tool',
  ],
  [
    'a pointer within each message of a thread that is no pointer',
    'thread',
    { ...aChat.thread, read: { ...aChat.thread.read, each: { ...aChat.thread.read.each, text: 'text' } } },
    '/chat/thread/read/each/text',
  ],
  ['a pointer to the address that is no pointer', 'sender', { ...aChat.sender, email: 'email' }, '/chat/sender/email'],
  ['a person read without their name', 'sender', without(aChat.sender, 'name'), '/chat/sender/name'],
  ['no condition of an active person', 'sender', { ...aChat.sender, active: {} }, '/chat/sender/active'],
  [
    'a condition of an active person on what is no pointer',
    'sender',
    { ...aChat.sender, active: { removed: [false] } },
    '/chat/sender/active/removed',
  ],
  [
    'a condition of an active person with no value',
    'sender',
    { ...aChat.sender, active: { '/person/removed': [] } },
    '/chat/sender/active//person/removed',
  ],
] as const;

describe('the refusals of the chat of an entry', () => {
  it.each(refusedParts)('refuses %s, at its place', (_, part, written: unknown, place) => {
    expect(pathsRefused(chatWith(part, written))).toEqual([place]);
  });
});

describe('the messages a person wrote, as a destination says them', () => {
  it('are taken over a socket, each kind in its order, and a kind that holds only the places it needs', () => {
    const needed = without(aMention, 'thread', 'account', 'time', 'automatic', 'changed', 'shared', 'own');

    expect([
      pathsRefused(sentBy(overASocketWithAChat)),
      pathsRefused(sentBy({ ...overASocketWithAChat, chat: [needed] })),
    ]).toEqual([[], []]);
  });

  it.each([
    ['no condition', { ...aMention, when: {} }, '/events/destinations/0/chat/0/when'],
    ['an ID read from a header', { ...aMention, id: '$message.header#/id' }, '/events/destinations/0/chat/0/id'],
    [
      'an account that is no runtime expression',
      { ...aMention, account: ['$message.payload#/space', 'space'] },
      '/events/destinations/0/chat/0/account/1',
    ],
    [
      'an edit told by a header',
      { ...aMention, changed: { '$message.header#/state': ['edited'] } },
      '/events/destinations/0/chat/0/changed/$message.header#/state',
    ],
    ['a kind of its own', { ...aMention, kind: 'thread' }, '/events/destinations/0/chat/0/kind'],
    [
      "the app's own user that is no runtime expression",
      { ...aMention, own: ['$message.payload#/message/author', 'app_user'] },
      '/events/destinations/0/chat/0/own/1',
    ],
  ] as const)('refuses %s, at its place', (_, declared: unknown, place) => {
    expect(pathsRefused(sentBy({ ...overASocketWithAChat, chat: [declared, ...others] }))).toEqual([place]);
  });

  it('are refused where nothing proves what the service delivered, as in a queue', () => {
    const queued = {
      type: 'queue',
      per: 'app',
      kind: 'azure-event-hubs',
      filter: { when: { '$message.payload#/kind': ['message'] } },
      connection: { account: '$message.payload#/space' },
      chat: chatKinds,
    };

    expect(pathsRefused(sentBy(queued))).toEqual(['/events/destinations/0/chat']);
  });
});
