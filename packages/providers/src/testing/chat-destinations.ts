import { overASocket, trackerOverASocket } from './event-destinations.ts';

export const aChat = {
  answer: {
    tool: 'post_message',
    with: { room: '{{ conversation }}', thread: '{{ thread | default: id }}', text: '{{ message }}' },
    sent: '/message/id',
    replace: {
      tool: 'edit_message',
      with: { room: '{{ conversation }}', message: '{{ sent.id }}', text: '{{ message }}' },
    },
  },
  ephemeral: {
    tool: 'post_private_line',
    with: { room: '{{ conversation }}', to: '{{ sender }}', text: '{{ message }}' },
  },
  thread: {
    tool: 'read_thread',
    with: { room: '{{ conversation }}', thread: '{{ thread | default: id }}' },
    read: {
      list: '/messages',
      order: 'oldest_first',
      each: { id: '/id', sender: '/author', text: '/text', time: '/sent_at', automatic: '/app' },
    },
  },
  sender: {
    tool: 'read_person',
    with: { person: '{{ sender }}' },
    email: '/person/email',
    email_verified: '/person/email_confirmed',
    account: '/person/space',
    active: { '/person/removed': [false, null], '/person/kind': ['member'] },
  },
};

const placesOfAMessage = {
  id: '$message.payload#/message/id',
  conversation: '$message.payload#/message/room',
  thread: '$message.payload#/message/thread',
  sender: '$message.payload#/message/author',
  account: ['$message.payload#/message/author_space', '$message.payload#/space'],
  text: '$message.payload#/message/text',
  time: '$message.payload#/message/sent_at',
  automatic: '$message.payload#/message/app',
  changed: { '$message.payload#/message/state': ['edited', 'deleted'] },
  shared: '$message.payload#/room/shared',
};

export const aMention = { kind: 'mention', when: { '$message.payload#/kind': ['mention'] }, ...placesOfAMessage };

export const chatKinds = [
  aMention,
  {
    kind: 'direct_message',
    when: { '$message.payload#/kind': ['message'], '$message.payload#/room/kind': ['direct'] },
    ...placesOfAMessage,
  },
  {
    kind: 'ambient',
    when: { '$message.payload#/kind': ['message'], '$message.payload#/room/kind': ['open', 'private'] },
    ...placesOfAMessage,
  },
];

export const overASocketWithAChat = { ...overASocket, chat: chatKinds };

export const chatOverASocket = { ...trackerOverASocket, chat: aChat, events: { destinations: [overASocketWithAChat] } };
