import { describe, expect, it } from 'vitest';

import { checkedDestinations, checkedNewestFirst, checkedOldestFirst, checkedPost } from '../testing/checked-apps.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import {
  aPost,
  firstDestination as destination,
  mapping,
  ofEachSubscription,
  ofTheApp,
  postType,
  reporting,
  roomType,
  sentBy,
  without,
} from '../testing/event-destinations.ts';
import { tracker } from '../testing/fixture-providers.ts';
import { declared } from '../testing/subscription-services.ts';
import { listedEventOf } from './arrival-readings.ts';
import { requestOriginsOf } from './event-destinations.ts';

const firstEvent = `${destination}/events/0`;

const placedTypes = [{ ...postType, subject: { title: 'Room', required: true } }, roomType];

function pathsOf(issues: readonly (readonly [string, string])[]): readonly string[] {
  return issues.map(([path]) => path);
}

function placedBy(topic: string) {
  return mapping(ofEachSubscription, { ...aPost, topic });
}

const readingByRequest = {
  method: 'GET',
  url: 'https://api.tracker.example.com/rooms/{{ topic }}/posts?after={{ since }}',
  list: '/posts',
  order: 'oldest_first',
  cursor: '/at',
};

describe('a destination that checks the app on a timer', () => {
  it('reads through a tool or a request, oldest or newest first, with a read limit, and maps every listed item where its events name no condition', () => {
    expect([
      reporting([checkedOldestFirst], placedTypes),
      reporting([{ ...checkedNewestFirst, read_limit: { quota: 60, window_seconds: 3600 } }], placedTypes),
      reporting([{ ...checkedOldestFirst, read: readingByRequest }], placedTypes),
      reporting(
        [
          { ...checkedOldestFirst, read: { ...checkedOldestFirst.read, start: '{{ now }}' } },
          placedBy('{{ subject }}'),
        ],
        placedTypes,
      ),
    ]).toEqual([[], [], [], []]);
  });
});

describe('the fields a destination that checks the app takes', () => {
  it('takes a read and no filter, and only it takes a read, a read limit or no filter', () => {
    expect([
      pathsOf(reporting([without(checkedOldestFirst, 'read')], placedTypes)),
      pathsOf(reporting([{ ...checkedOldestFirst, filter: ofTheApp.filter }], placedTypes)).slice(0, 1),
      pathsOf(reporting([{ ...checkedOldestFirst, topic: '{{ with.room }}' }], placedTypes)),
      pathsOf(sentBy({ ...ofTheApp, read: checkedOldestFirst.read, read_limit: { quota: 1, window_seconds: 1 } })),
      pathsOf(sentBy(without(ofEachSubscription, 'filter'))),
    ]).toEqual([
      [`${destination}/read`],
      [`${destination}/filter`],
      [`${destination}/topic`],
      [`${destination}/read`, `${destination}/read_limit`],
      [`${destination}/filter`],
    ]);
  });

  it('refuses a call written as no call of the format is, a template that reads what a read has not, and a place in the answer that is no JSON Pointer', () => {
    const read = checkedOldestFirst.read;

    expect([
      pathsOf(reporting([{ ...checkedOldestFirst, read: { ...read, tool: 'list posts' } }], placedTypes)),
      pathsOf(
        reporting([{ ...checkedOldestFirst, read: { ...read, with: { id: '{{ subscription.id }}' } } }], placedTypes),
      ),
      pathsOf(reporting([{ ...checkedOldestFirst, read: { ...read, start: '{{ since }}' } }], placedTypes)),
      pathsOf(
        reporting(
          [{ ...checkedOldestFirst, read: { ...read, list: 'posts', cursor: 'at', next_page_token: 'next' } }],
          placedTypes,
        ),
      ),
      pathsOf(reporting([{ ...checkedOldestFirst, read: { ...readingByRequest, url: '{{ topic }}' } }], placedTypes)),
    ]).toEqual([
      [`${destination}/read/tool`],
      [`${destination}/read/with/id`],
      [`${destination}/read/start`],
      [`${destination}/read/list`, `${destination}/read/cursor`, `${destination}/read/next_page_token`],
      [`${destination}/read/url`],
    ]);
  });
});

const checkedRoom = {
  type: roomType.type,
  when: {},
  id: ['$message.payload#/id'],
  subject: '$message.payload#/room',
  data: { name: '$message.payload#/name' },
};

const placedRooms = [...placedTypes.slice(0, 1), { ...roomType, subject: { title: 'Room', required: true } }];

function checkingRooms(topic: string): Readonly<Record<string, unknown>> {
  return {
    type: 'polling',
    read: {
      tool: 'list_rooms',
      with: { room: '{{ topic }}', after: '{{ since }}' },
      list: '/rooms',
      order: 'oldest_first',
      cursor: '/at',
    },
    events: [{ ...checkedRoom, topic }],
  };
}

function checkingPosts(topic: string): Readonly<Record<string, unknown>> {
  return { ...checkedOldestFirst, events: [{ ...checkedPost, topic }] };
}

const postsByHook = mapping(
  { ...ofEachSubscription, topic: 'posts in {{ with.project }}' },
  { ...aPost, topic: 'posts in {{ subject }}' },
);

const takenTogether = [
  {
    what: 'two checks whose topics start apart',
    destinations: [checkingPosts('posts in {{ subject }}'), checkingRooms('rooms in {{ subject }}')],
  },
  {
    what: 'two checks whose topics part before either ends',
    destinations: [checkingPosts('posts in {{ subject }}'), checkingRooms('room {{ subject }}')],
  },
  {
    what: 'a later check of only what an earlier check reports, under the same topic',
    destinations: [checkingPosts('{{ subject }}'), checkingPosts('{{ subject }}')],
  },
  {
    what: 'a check of only what an earlier webhook reports, under the same topic',
    destinations: [placedBy('{{ subject }}'), checkingPosts('{{ subject }}')],
  },
] as const;

const refusedTogether = [
  {
    what: 'whose earlier topic starts with nothing written',
    destinations: [checkingPosts('{{ subject }}'), checkingRooms('rooms in {{ subject }}')],
  },
  {
    what: 'whose earlier topic starts the later',
    destinations: [checkingPosts('posts {{ subject }}'), checkingRooms('posts in {{ subject }}')],
  },
  {
    what: 'whose later topic starts the earlier',
    destinations: [checkingPosts('posts in {{ subject }}'), checkingRooms('posts {{ subject }}')],
  },
  {
    what: 'whose earlier topic writes no expression, and starts the later',
    destinations: [checkingPosts('rooms'), checkingRooms('rooms in {{ subject }}')],
  },
  {
    what: 'whose topics part only in the spaces a tag may trim',
    destinations: [checkingPosts('in {{ subject }}'), checkingRooms('in {{- subject }}')],
  },
  {
    what: 'whose earlier topic starts with a tag, read up to it',
    destinations: [checkingPosts('room{% if true %}s{% endif %} {{ subject }}'), checkingRooms('rooms {{ subject }}')],
  },
  {
    what: 'whose later topic starts as a webhook’s topic of its events does',
    destinations: [postsByHook, checkingRooms('posts in {{ subject }}')],
  },
  {
    what: 'whose later topic could render as the topic an earlier webhook gives a request',
    destinations: [
      mapping(ofEachSubscription, { ...aPost, topic: 'posts in {{ subject }}' }),
      checkingRooms('rooms in {{ subject }}'),
    ],
  },
] as const;

describe('the topics of the destinations of one entry', () => {
  it.each(takenTogether)('take $what', ({ destinations }) => {
    expect(reporting(destinations, placedRooms)).toEqual([]);
  });

  it.each(refusedTogether)(
    'refuse a later destination that reports an event the earlier does not, $what',
    ({ destinations }) => {
      expect(pathsOf(reporting(destinations, placedRooms))).toEqual(['/events/destinations/1/events/0/topic']);
    },
  );
});

describe('the events of a destination', () => {
  it('refuses an event whose when names no condition on a destination the service sends to', () => {
    expect(pathsOf(reporting([mapping(ofTheApp, { ...aPost, when: {} })], placedTypes))).toEqual([
      `${firstEvent}/when`,
    ]);
  });

  it('sends the credential of a read written as a request to the origin it is written out to', () => {
    const entry = {
      ...tracker,
      events: { types: placedTypes, destinations: [{ ...checkedOldestFirst, read: readingByRequest }] },
    };

    expect(requestOriginsOf(decodedEntry(entry))).toEqual(['https://api.tracker.example.com']);
  });
});

const [everyItem] = checkedDestinations(checkedOldestFirst);

const [onlyPinned] = checkedDestinations({
  ...checkedOldestFirst,
  events: [{ ...checkedPost, when: { '$message.payload#/pinned': ['yes'] } }],
});

const post = { id: 'p-1', room: 'lobby', at: '2026-10-07T09:00:00.000Z', words: 'hello' };

describe('an item a check lists, read as the event it is', () => {
  it('is the event of the first entry it matches, every listed item matching where the entry names no condition', () => {
    expect([
      listedEventOf(declared(everyItem), post),
      listedEventOf(declared(onlyPinned), post),
      listedEventOf(declared(onlyPinned), { ...post, pinned: 'yes' }),
    ]).toEqual([
      {
        type: checkedPost.type,
        id: 'com.example.chat.post/p-1/2026-10-07T09%3A00%3A00.000Z',
        time: post.at,
        subject: 'lobby',
        data: { words: 'hello' },
      },
      undefined,
      expect.objectContaining({ id: 'com.example.chat.post/p-1/2026-10-07T09%3A00%3A00.000Z' }),
    ]);
  });

  it('is no event where it holds no value at a part of its id', () => {
    expect(listedEventOf(declared(everyItem), { room: 'lobby', at: post.at })).toBeUndefined();
  });
});
