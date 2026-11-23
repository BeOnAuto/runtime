import type { TriggerRead } from '@on.auto/definitions/trigger-reads';
import { Unavailable } from '@on.auto/operations';
import type { Json, JsonObject } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionsReporting } from '../testing/connection-events.ts';
import type { ConnectionReporting, Hearing } from './connection-ports.ts';
import { connectionRejectionsOf, connectionTriggersChecked } from './connection-triggers.ts';
import {
  filterWithoutRead,
  readRejectionsOf,
  readWrittenIn,
  type ToolsListed,
  type ToolsOffered,
} from './trigger-reads.ts';

const listing = {
  tool: 'list_bookings',
  with: { created_after: '{{ since }}', page: '{{ page_token }}' },
  list: '/bookings',
  order: 'oldest_first',
  cursor: '/created_at',
  next_page_token: '/next',
  start: '{{ now }}',
  id: ['/id'],
  time: '/created_at',
} as const;

const { id: _id, ...withoutId } = listing;

const { tool: _tool, ...withoutTool } = listing;

const withNoSource: JsonObject = { with: { type: 'booking.created' }, read: listing };

const withNothingToMatch: JsonObject = { read: listing };

function filterOf(read: Json, source = '/connections/bookings'): JsonObject {
  return { with: { type: 'booking.created', source }, read };
}

function refusedAt(read: Json): readonly string[] {
  return readWrittenIn(filterOf(read), '/schedule/on/one').rejections.map(({ pointer }) => pointer);
}

describe('the read a filter names, as its workflow is read', () => {
  it('is taken as written where the filter names a connection, and none where the filter names no read', () => {
    expect(readWrittenIn(filterOf(listing), '/schedule/on/one')).toEqual({ read: listing, rejections: [] });
    expect(readWrittenIn({ with: { type: 'booking.created' } }, '/schedule/on/one')).toEqual({ rejections: [] });
    expect(readWrittenIn('a filter', '/schedule/on/one')).toEqual({ rejections: [] });
  });

  it.each([
    ['a filter whose source names no connection', filterOf(listing, '/runs/one'), ['/read']],
    ['a filter with no source', withNoSource, ['/read']],
    ['a filter with nothing to match', withNothingToMatch, ['/read']],
    ['a read with no id', filterOf(withoutId), ['/read']],
    ['a read that is not a mapping', filterOf('list_bookings'), ['/read']],
    ['a read with no tool', filterOf(withoutTool), ['/read/tool']],
    ['an order of its own', filterOf({ ...listing, order: 'by_name' }), ['/read/order']],
    ['a key a read does not take', filterOf({ ...listing, every: 'PT1M' }), ['/read/every']],
    ['an id that is no list', filterOf({ ...listing, id: '/id' }), ['/read/id']],
    ['an empty id', filterOf({ ...listing, id: [] }), ['/read/id']],
    [
      'a pointer into an item that is no JSON Pointer',
      filterOf({ ...listing, id: ['id'], cursor: 'created_at' }),
      ['/read/id/0', '/read/cursor'],
    ],
    [
      'a pointer into the answer that is no JSON Pointer',
      filterOf({ ...listing, list: 'bookings', next_page_token: 'next' }),
      ['/read/list', '/read/next_page_token'],
    ],
    ['a time that is no JSON Pointer', filterOf({ ...listing, time: 'at' }), ['/read/time']],
    [
      'an argument that reads a name a read does not have',
      filterOf({ ...listing, with: { after: '{{ topic }}' } }),
      ['/read/with/after'],
    ],
    ['a start that reads a name it does not have', filterOf({ ...listing, start: '{{ since }}' }), ['/read/start']],
  ] as const)('is refused for %s', (_case, filter, at) => {
    const refused = readWrittenIn(filter, '/schedule/on/one');

    expect(refused.rejections.map(({ pointer }) => pointer)).toEqual(at.map((place) => `/schedule/on/one${place}`));
    expect(refused).not.toHaveProperty('read');
  });

  it('takes the whole answer as the list', () => {
    expect(refusedAt({ ...listing, list: '' })).toEqual([]);
  });
});

describe('a filter without its read', () => {
  it('keeps every other key, and leaves what is not a mapping as it is', () => {
    expect(filterWithoutRead(filterOf(listing))).toEqual({
      with: { type: 'booking.created', source: '/connections/bookings' },
    });
    expect(filterWithoutRead('a filter')).toBe('a filter');
  });
});

const anyArgument: ToolsListed = {
  kind: 'listed',
  tools: [
    {
      name: 'list_bookings',
      mark: 'reads',
      input_schema: { type: 'object', properties: { filter: {}, limit: {}, query: {} } },
    },
  ],
};

function askedWith(written: NonNullable<TriggerRead['with']>): readonly string[] {
  const read: TriggerRead = { tool: 'list_bookings', list: '/b', order: 'oldest_first', id: ['/id'], with: written };
  const asked = { connection: 'bookings', reference: '/schedule/on/one', type: 'booking.created', read };
  return readRejectionsOf(asked, anyArgument).map(({ pointer }) => pointer);
}

describe('whether a read asks for what is new', () => {
  it.each([
    ['in a list', { filter: ['created', { after: '{{ since }}' }] }, []],
    ['nowhere among values that are not text', { limit: 20, filter: null }, ['/schedule/on/one/read']],
    ['nowhere in a template that cannot be read', { query: '{{ since ' }, ['/schedule/on/one/read']],
  ] as const)('is read from where its arguments name since: %s', (_case, written, refused) => {
    expect(askedWith(written)).toEqual(refused);
  });
});

const place = { org: 'acme', playbook: 'alpha', name: 'on-items' };

const listingBookings = {
  tool: 'list_bookings',
  with: { created_after: '{{ since }}' },
  list: '/bookings',
  order: 'oldest_first',
  id: ['/id'],
} as const satisfies TriggerRead;

const sortedBookings: TriggerRead = { ...listingBookings, with: { created_after: '{{ since }}', sort: 'asc' } };

function readingOf(_type: string, { tool, with: written }: TriggerRead): Hearing {
  return { kind: 'heard', subscribes: { topic: `${tool} ${JSON.stringify(written ?? {})}`, mostTopics: 2 } };
}

const toolsOfTheBookings: ToolsOffered = {
  kind: 'listed',
  tools: [
    {
      name: 'list_bookings',
      mark: 'reads',
      input_schema: { type: 'object', properties: { created_after: { type: 'string' }, sort: { type: 'string' } } },
    },
    { name: 'list_rooms', mark: 'reads', input_schema: { type: 'object' } },
    { name: 'cancel_booking', mark: 'acts', input_schema: { type: 'object', properties: { id: {} } } },
    { name: 'list_guests', mark: 'unmarked', input_schema: { type: 'object', properties: { after: {} } } },
  ],
};

const bookings: ConnectionReporting = {
  status: 'connected',
  types: [],
  hearing: () => Effect.die('an event was asked'),
  reading: (type, read) => Effect.succeed(readingOf(type, read)),
  tools: Effect.succeed(toolsOfTheBookings),
  listenedBy: [],
};

const reporting = {
  bookings,
  tracker: { ...bookings, types: [{ type: 'com.example.item.added', title: 'An item is added' }] },
  booked: {
    ...bookings,
    listenedBy: [
      { workflow: 'on-rooms', type: 'room.added', read: { ...listingBookings, tool: 'list_rooms' } },
      { workflow: 'on-items', type: 'booking.created', read: { ...listingBookings, with: { sort: 'old' } } },
    ],
  },
  checkedTwice: {
    ...bookings,
    listenedBy: [
      { workflow: 'on-bookings', type: 'booking.created', read: listingBookings },
      { workflow: 'on-sorted', type: 'booking.sorted', read: sortedBookings },
    ],
  },
  closedDown: { ...bookings, status: 'broken' },
  unreachable: { ...bookings, tools: Effect.succeed({ kind: 'unavailable', detail: 'The connection is down.' }) },
} satisfies Readonly<Record<string, ConnectionReporting>>;

function reading(source: string, read: TriggerRead, type = 'booking.created'): JsonObject {
  return { with: { type, source }, read };
}

function workflowOn(filters: readonly JsonObject[]) {
  return { document: { schedule: { on: { any: [...filters] } }, do: [] }, locate: () => ({ line: 7, column: 9 }) };
}

async function savedAt(filters: readonly JsonObject[]): Promise<readonly string[]> {
  const rejections = await Effect.runPromise(
    connectionRejectionsOf(connectionsReporting(reporting), workflowOn(filters), place),
  );
  return rejections.map(({ pointer }) => pointer);
}

const refusedReads = [
  ['a tool the connection does not offer', { ...listingBookings, tool: 'list_x' }, '/read/tool'],
  [
    'a tool marked as one that acts',
    { ...listingBookings, tool: 'cancel_booking', with: { id: '{{ since }}' } },
    '/read/tool',
  ],
  [
    'a tool that carries no mark, which counts as one that acts',
    { ...listingBookings, tool: 'list_guests', with: { after: '{{ since }}' } },
    '/read/tool',
  ],
  [
    'an argument the tool does not declare',
    { ...listingBookings, with: { created_after: '{{ since }}', 'colour/hue': 'red' } },
    '/read/with/colour~1hue',
  ],
  [
    'an argument of a tool that declares none',
    { ...listingBookings, tool: 'list_rooms', with: { since: '{{ since }}' } },
    '/read/with/since',
  ],
  ['a read that cannot ask for what is new', { ...listingBookings, with: { sort: 'asc' } }, '/read'],
  [
    'a read listed newest first with no cursor',
    { ...listingBookings, with: { sort: 'asc' }, order: 'newest_first' },
    '/read',
  ],
] as const satisfies readonly (readonly [string, TriggerRead, string])[];

describe('a trigger whose filter names a tool of the connection to check, as its workflow is saved', () => {
  it.each(refusedReads)('is refused for %s', async (_case, read, at) => {
    expect(await savedAt([reading('/connections/bookings', read)])).toEqual([`/schedule/on/any/0${at}`]);
  });

  it.each([
    [
      'a type that is not a name of its own',
      reading('/connections/bookings', listingBookings, 'Booking_Created'),
      '/with/type',
    ],
    ['a read on a connection that lists its own events', reading('/connections/tracker', listingBookings), '/read'],
    ['a read through a broken connection', reading('/connections/closedDown', listingBookings), '/with/source'],
    [
      'no read through a connection that lists no events',
      { with: { type: 'booking.created', source: '/connections/bookings' } },
      '/with/type',
    ],
  ] as const)('is refused for %s', async (_case, filter, at) => {
    expect(await savedAt([filter])).toEqual([`/schedule/on/any/0${at}`]);
  });

  it.each([
    ['one whose arguments read where the last check got to', listingBookings],
    [
      'one listed newest first with a cursor',
      { ...listingBookings, with: { sort: 'desc' }, order: 'newest_first', cursor: '/created_at' },
    ],
    [
      'one with no arguments, listed newest first with a cursor',
      { tool: 'list_rooms', list: '', order: 'newest_first', cursor: '/at', id: ['/id'] },
    ],
  ] as const satisfies readonly (readonly [string, TriggerRead])[])('is taken for %s', async (_case, read) => {
    expect(await savedAt([reading('/connections/bookings', read)])).toEqual([]);
  });
});

describe('the places a playbook’s triggers check through one connection', () => {
  it('are refused past the most one connection holds, counting the reads of the playbook’s other workflows', async () => {
    const sorted = reading('/connections/booked', sortedBookings, 'booking.sorted');

    expect(await savedAt([reading('/connections/booked', listingBookings), sorted])).toEqual([
      '/schedule/on/any/1/read',
    ]);
  });

  it('are not saved while the connection’s tools cannot be listed, as a service unavailable', async () => {
    const checked = connectionTriggersChecked(connectionsReporting(reporting));
    const unreachable = workflowOn([reading('/connections/unreachable', listingBookings)]);

    expect(await Effect.runPromise(Effect.flip(checked(unreachable, place)))).toBeInstanceOf(Unavailable);
  });
});

describe('the read a type names through one connection, as a workflow is saved', () => {
  it.each([
    ['the read another workflow checks, sharing its place', 'checkedTwice', [listingBookings], []],
    ['another read under the type another workflow checks', 'checkedTwice', [sortedBookings], [0]],
    ['another read under the type of its earlier version', 'booked', [listingBookings], []],
    ['two reads under one type in one workflow', 'bookings', [listingBookings, sortedBookings], [1]],
  ] as const)('takes or refuses %s', async (_case, connection, reads, refused) => {
    const filters = reads.map((read) => reading(`/connections/${connection}`, read));

    expect(await savedAt(filters)).toEqual(refused.map((index) => `/schedule/on/any/${index}/read`));
  });
});
