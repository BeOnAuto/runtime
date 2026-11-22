import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import {
  aPost,
  aRoomOpened,
  mapping,
  ofTheApp,
  overASocket,
  postTypes,
  trackerOverASocket,
  whoItActsAs,
} from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import { arrivalReadingOf, type Arrival, type ArrivalReading } from './arrival-readings.ts';
import { millisecondsSinceTheEpochOf } from './event-times.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

type Reader = (arrival: Arrival) => ArrivalReading | undefined;

function readerOf(declared: object, type: 'webhook' | 'websocket' = 'webhook'): Reader {
  const events = { types: postTypes, identity: whoItActsAs, destinations: [declared] };
  const entry = { ...trackerOverASocket, events };
  const destination = eventDestinationOf(providersOf(entry), 'tracker', type);
  return (arrival) => (destination === undefined ? undefined : arrivalReadingOf(destination, arrival));
}

function aRequest(body: Schema.Json): Arrival {
  return { transport: 'request', headers: {}, query: {}, body };
}

const readThePosts = readerOf(mapping(ofTheApp, aPost, aRoomOpened));

const thePost: Fields = { room: 'R0OPS', seq: 17, at: '2026-11-20T09:00:00Z', words: 'The build is red', by: 'M0ADA' };

function aPostIn(post: Fields, ...left: readonly string[]): Arrival {
  const kept = Object.entries({ ...thePost, ...post }).filter(
    ([key]: readonly [string, Schema.Json]) => !left.includes(key),
  );
  return aRequest({
    kind: 'post',
    team_id: 'T0TEAM',
    installation: { member: 'M0AUTO' },
    post: Object.fromEntries(kept),
  });
}

const ofTheTeam = { connection: { account: 'T0TEAM' } };

const posted = {
  type: 'com.example.chat.post',
  id: 'R0OPS/17',
  time: '2026-11-20T09:00:00Z',
  subject: 'R0OPS',
  data: { words: 'The build is red', by: 'M0ADA' },
};

function postedAt(at: Schema.Json): string | undefined {
  return readThePosts(aPostIn({ at }))?.event?.time;
}

describe('the event an arrival is', () => {
  it('is of the type its mapping declares, its id joined from every part, with its time, its subject and its data', () => {
    expect(readThePosts(aPostIn({}))).toEqual({ event: posted, ...ofTheTeam });
  });

  it('takes an id of one part, and leaves out what its mapping does not declare', () => {
    expect(readThePosts(aRequest({ kind: 'room', team_id: 'T0TEAM', room: { key: 'K-1', name: 'ops' } }))).toEqual({
      event: { type: 'com.example.chat.room.opened', id: 'K-1', data: { name: 'ops' } },
      ...ofTheTeam,
    });
  });
});

describe('the mapping an arrival is read by', () => {
  it('is the first whose when holds and every part of whose id is text that is not empty or a number', () => {
    const readEither = readerOf(mapping(ofTheApp, aPost, { ...aRoomOpened, when: aPost.when }));
    const both = { kind: 'post', team_id: 'T0TEAM', post: { room: 'R0OPS' }, room: { key: 'K-1' } };

    expect([
      readEither(aRequest(both)),
      readEither(aRequest({ ...both, post: thePost }))?.event?.type,
      readThePosts(aPostIn({ seq: '' })),
      readThePosts(aPostIn({ seq: true })),
      readThePosts(aPostIn({ seq: null })),
      readThePosts(aRequest({ kind: 'reply', team_id: 'T0TEAM', post: thePost })),
    ]).toEqual([
      { event: { type: 'com.example.chat.room.opened', id: 'K-1', data: {} }, ...ofTheTeam },
      'com.example.chat.post',
      ofTheTeam,
      ofTheTeam,
      ofTheTeam,
      ofTheTeam,
    ]);
  });

  it('writes each part of the id as a segment of a URI path, so that no two different ids join alike', () => {
    expect([
      readThePosts(aPostIn({ room: 'R/1', seq: '7' }))?.event?.id,
      readThePosts(aPostIn({ room: 'R', seq: '1/7' }))?.event?.id,
      readThePosts(aPostIn({ room: 'R 1%', seq: 7 }))?.event?.id,
    ]).toEqual(['R%2F1/7', 'R/1%2F7', 'R%201%25/7']);
  });
});

describe('an event that an app or the connection itself made', () => {
  it('is marked automatic where automatic holds anything but null, an app having done it', () => {
    expect([
      readThePosts(aPostIn({ app: 'A0BOT' }))?.event,
      readThePosts(aPostIn({ app: false }))?.event?.automatic,
      readThePosts(aPostIn({ app: null }))?.event,
    ]).toEqual([{ ...posted, automatic: true }, true, posted]);
  });

  it('is none where changed holds anything but null, an edit, a deletion or a notice', () => {
    expect([readThePosts(aPostIn({ edit_of: 'P-1' })), readThePosts(aPostIn({ edit_of: null }))]).toEqual([
      ofTheTeam,
      { event: posted, ...ofTheTeam },
    ]);
  });

  it('is told by conditions written as when, as well as by a place that holds something only then', () => {
    const byValue = {
      ...aPost,
      automatic: { '$request.body#/post/by_kind': ['app', 'integration'] },
      changed: { '$request.body#/post/state': ['edited', null] },
    };
    const readByValue = readerOf(mapping(ofTheApp, byValue));

    expect([
      readByValue(aPostIn({ state: 'new', by_kind: 'app' }))?.event?.automatic,
      readByValue(aPostIn({ state: 'new', by_kind: 'person' }))?.event,
      readByValue(aPostIn({ state: 'edited' })),
      readByValue(aPostIn({})),
    ]).toEqual([true, posted, ofTheTeam, ofTheTeam]);
  });

  it('is none where own names the same account twice, the connection having done it itself', () => {
    const unnamed = aRequest({ kind: 'post', team_id: 'T0TEAM', post: thePost });

    expect([
      readThePosts(aPostIn({ by: 'M0AUTO' })),
      readThePosts(unnamed)?.event?.id,
      readThePosts(aPostIn({ by: '' }))?.event?.id,
    ]).toEqual([ofTheTeam, 'R0OPS/17', 'R0OPS/17']);
  });
});

describe('the account that did what an event reports', () => {
  it('is named where actor is declared, as text that is not empty or a whole number written as text', () => {
    const readWhoPosted = readerOf(mapping(ofTheApp, { ...aPost, actor: '$request.body#/post/by' }));
    const actorOf = (by: Schema.Json) => readWhoPosted(aPostIn({ by }))?.event?.actor;

    expect([actorOf('M0ADA'), actorOf(4_242), actorOf(''), actorOf(1.5)]).toEqual([
      'M0ADA',
      '4242',
      undefined,
      undefined,
    ]);
  });
});

describe('the time of an event', () => {
  it('is an RFC 3339 date-time, read as one or as seconds since the epoch, and none otherwise', () => {
    expect([
      postedAt('2026-11-20T10:00:00+01:00'),
      postedAt('1763629200'),
      postedAt('1763629200.000100'),
      postedAt(1_763_629_200.5),
      postedAt('1763629200.1234567891'),
      postedAt('yesterday'),
      postedAt('2026-02-30T10:00:00Z'),
      postedAt('999999999999999'),
      postedAt('300000000000'),
      postedAt(-1),
      postedAt(null),
    ]).toEqual([
      '2026-11-20T10:00:00+01:00',
      '2025-11-20T09:00:00Z',
      '2025-11-20T09:00:00.000100Z',
      '2025-11-20T09:00:00.5Z',
      '2025-11-20T09:00:00.123456789Z',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('a time a delivery names, in milliseconds since the epoch, as a reply’s is taken', () => {
  it.each([
    ['seconds since the epoch, written as text', '1763629200.5', 1_763_629_200_500],
    ['seconds since the epoch, as a number', 1_763_629_200, 1_763_629_200_000],
    ['an RFC 3339 date-time', '2025-11-20T09:00:00.250Z', 1_763_629_200_250],
    ['an RFC 3339 date-time with an offset', '2025-11-20T10:00:00+01:00', 1_763_629_200_000],
    ['neither', 'yesterday', undefined],
    ['nothing', undefined, undefined],
  ] as const)('is the instant it names as %s, and none otherwise', (_, time, taken) => {
    expect(millisecondsSinceTheEpochOf(time)).toBe(taken);
  });
});

describe('the data and the subject of an event', () => {
  it('carry each field that holds anything but null, whatever its kind, and the subject only as text that is not empty', () => {
    expect([
      readThePosts(aPostIn({ words: { blocks: ['red'] }, by: null }))?.event?.data,
      readThePosts(aPostIn({}, 'words'))?.event?.data,
      readThePosts(aPostIn({ room: 7 }))?.event,
    ]).toEqual([
      { words: { blocks: ['red'] } },
      { by: 'M0ADA' },
      { type: posted.type, id: '7/17', time: posted.time, data: posted.data },
    ]);
  });
});

const fromThePayload = {
  ...aPost,
  when: { '$message.payload#/type': ['events_api'] },
  id: ['$message.payload#/payload/post/room', '$message.payload#/payload/post/seq'],
  time: '$message.payload#/payload/post/at',
  subject: '$message.payload#/payload/post/room',
  data: { words: '$message.payload#/payload/post/words' },
  automatic: '$message.payload#/payload/post/app',
  changed: '$message.payload#/payload/post/edit_of',
  own: ['$message.payload#/payload/post/by', '$message.payload#/payload/member'],
  actor: '$message.payload#/payload/post/by',
};

describe('the event a message down a socket is', () => {
  it('is read as a request’s is, beside the wake and the connection', () => {
    const readOverASocket = readerOf(mapping(overASocket, fromThePayload), 'websocket');
    const payload = { team_id: 'T0TEAM', member: 'M0AUTO', post: thePost, event: { channel: 'R0OPS', user: 'M0ADA' } };

    expect(readOverASocket({ transport: 'message', payload: { type: 'events_api', payload } })).toEqual({
      wake: { conversation: 'R0OPS' },
      event: { ...posted, data: { words: 'The build is red' }, actor: 'M0ADA' },
      connection: { account: 'T0TEAM', user: 'M0ADA' },
    });
  });
});
