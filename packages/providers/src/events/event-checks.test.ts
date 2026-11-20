import { describe, expect, it } from 'vitest';

import {
  aPost,
  aRoomOpened,
  firstDestination as destination,
  intoAQueue,
  mapping,
  ofEachSubscription,
  ofTheApp,
  overASocket,
  postType,
  reporting,
  roomType,
  sentBy,
  unplacedPostType,
  without,
} from '../testing/event-destinations.ts';

const firstEvent = `${destination}/events/0`;

const aRoomOverASocket = {
  ...aRoomOpened,
  when: { '$message.payload#/kind': ['room'] },
  id: ['$message.payload#/room/key'],
  data: { name: '$message.payload#/room/name' },
};

const placedTypes = [{ ...postType, subject: { title: 'Room', required: true } }, roomType];

function pathsOf(issues: readonly (readonly [string, string])[]): readonly string[] {
  return issues.map(([path]) => path);
}

function placedBy(topic: string) {
  return mapping(ofEachSubscription, { ...aPost, topic });
}

describe('the events a destination reports', () => {
  it('are declared on a webhook whose proof covers the body, and on a socket', () => {
    expect([
      reporting([mapping(ofTheApp, aPost, aRoomOpened)]),
      reporting([mapping(ofTheApp, without(aRoomOpened, 'data'))]),
      reporting([mapping(overASocket, aRoomOverASocket)]),
      reporting([mapping({ ...ofTheApp, verify: { scheme: 'standard-webhooks', secret: 'app' } }, aPost)]),
      reporting([placedBy('{{ subject }}')], placedTypes),
    ]).toEqual([[], [], [], [], []]);
  });

  it('are refused where a header proves who sent a delivery and not its body, and out of a queue, which nothing proves', () => {
    const bearing = { scheme: 'bearer', secret: 'app', token: '$request.header.X-Chat-Token' };
    const signing = { scheme: 'jwt', secret: 'app', token: '$request.header.Authorization', alg: 'HS256' };

    expect([
      pathsOf(reporting([mapping({ ...ofTheApp, verify: bearing }, aPost)])),
      pathsOf(reporting([mapping({ ...ofTheApp, verify: signing }, aPost)])),
      pathsOf(reporting([mapping(intoAQueue, { ...aRoomOverASocket, topic: 'rooms' })])),
    ]).toEqual([[`${destination}/events`], [`${destination}/events`], [`${destination}/events`]]);
  });

  it('are beside the account a delivery names, which a destination of the app always takes', () => {
    expect(pathsOf(reporting([mapping(without(ofTheApp, 'connection'), aPost)]))).toEqual([
      `${destination}/connection`,
    ]);
  });
});

const outside = {
  ...aPost,
  when: { '$request.header.X-Chat-Event': ['post'] },
  id: ['$request.body#/post/room', '$request.query.seq'],
  time: '$request.header.X-Chat-Time',
  subject: 'post.room',
  data: { words: '$request.body#/post/words', by: '$message.payload#/post/by' },
  automatic: '$request.header.X-Chat-App',
  changed: '$request.query.edited',
  own: ['$request.header.X-Chat-Member', '$request.body#/installation/member'],
};

describe('where a delivery holds the parts of an event', () => {
  it('is the body of a request alone, each part read elsewhere refused at its place', () => {
    expect(pathsOf(reporting([mapping(ofTheApp, outside)]))).toEqual([
      `${firstEvent}/when/$request.header.X-Chat-Event`,
      `${firstEvent}/id/1`,
      `${firstEvent}/time`,
      `${firstEvent}/subject`,
      `${firstEvent}/automatic`,
      `${firstEvent}/changed`,
      `${firstEvent}/data/by`,
      `${firstEvent}/own/0`,
    ]);
  });

  it('is read from the body alone where an app did it or nothing is new, told by a place or by conditions', () => {
    const byValue = {
      ...aPost,
      automatic: { '$request.body#/sender/type': ['Bot'] },
      changed: { '$request.body#/post/state': ['edited', null] },
    };
    const outsideByValue = { ...byValue, automatic: { '$request.header.X-Chat-App': ['yes'] }, changed: {} };

    expect([
      pathsOf(reporting([mapping(ofTheApp, byValue)])),
      pathsOf(reporting([mapping(ofTheApp, outsideByValue)])),
    ]).toEqual([[], [`${firstEvent}/automatic/$request.header.X-Chat-App`, `${firstEvent}/changed`]]);
  });

  it('is the payload of a message alone, with one condition at least', () => {
    const fromItsHeaders = { ...aRoomOverASocket, id: ['$message.header#/key'], when: {} };

    expect(pathsOf(reporting([mapping(overASocket, fromItsHeaders)]))).toEqual([
      `${firstEvent}/when`,
      `${firstEvent}/id/0`,
    ]);
  });
});

describe('the topic of an event', () => {
  it('is named on each where the destination subscribes for each place, and on none otherwise', () => {
    expect([
      pathsOf(reporting([mapping(ofEachSubscription, aPost)])),
      pathsOf(reporting([mapping(ofTheApp, { ...aPost, topic: '{{ subject }}' })])),
      pathsOf(reporting([mapping(overASocket, { ...aRoomOverASocket, topic: 'rooms' })])),
    ]).toEqual([[firstEvent], [`${firstEvent}/topic`], [`${firstEvent}/topic`]]);
  });

  it('is a template that reads the subject alone', () => {
    expect([
      pathsOf(reporting([placedBy('{{ with.project }}')], placedTypes)),
      pathsOf(reporting([placedBy('{{ subject')], placedTypes)),
    ]).toEqual([[`${firstEvent}/topic`], [`${firstEvent}/topic`]]);
  });

  it('written from the subject, makes a trigger name one', () => {
    expect([
      pathsOf(reporting([placedBy('{{ subject }}')])),
      pathsOf(reporting([placedBy('{{ subject }}')], [unplacedPostType])),
      pathsOf(reporting([placedBy('every-room')])),
    ]).toEqual([['/events/types/0/subject'], ['/events/types/0/subject'], []]);
  });
});

describe('the types of events an entry declares', () => {
  it('are each declared once, and each type a destination maps is one of them', () => {
    expect([
      pathsOf(reporting([mapping(ofTheApp, aPost)], [postType, roomType, { ...roomType, title: 'A room opens' }])),
      pathsOf(reporting([mapping(ofTheApp, aPost, aRoomOpened)], [roomType])),
      pathsOf(sentBy(mapping(ofTheApp, aRoomOpened))),
      pathsOf(reporting([mapping(ofTheApp, aRoomOpened)], [])),
    ]).toEqual([['/events/types/2/type'], [`${firstEvent}/type`], [`${firstEvent}/type`], ['/events/types']]);
  });

  it('carry the JSON Schema of their data, a type and a title, and a subject with its title and whether a trigger names one', () => {
    const declared = [
      { ...roomType, data: { type: 'room' } },
      { type: '', title: '', subject: { title: 'Room' }, data: {} },
    ];

    expect(pathsOf(reporting([mapping(ofTheApp, aRoomOpened)], declared))).toEqual([
      expect.stringMatching(/^\/events\/types\/0\/data\//u),
      '/events/types/1/type',
      '/events/types/1/title',
      '/events/types/1/subject/required',
    ]);
  });
});
