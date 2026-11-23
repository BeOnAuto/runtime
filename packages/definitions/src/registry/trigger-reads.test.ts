import { describe, expect, it } from 'vitest';

import { readingAnotherUnderTheirType, readTopicOf, type DeclaredRead, type TriggerRead } from './trigger-reads.ts';

const listing: TriggerRead = {
  tool: 'list_bookings',
  with: { created_after: '{{ since }}', sort: 'asc' },
  list: '/bookings',
  order: 'oldest_first',
  cursor: '/created_at',
  id: ['/id'],
};

describe('the topic of a read a trigger names', () => {
  it('is the same for the same type and read, however the keys of either are ordered', () => {
    const reordered: TriggerRead = {
      id: ['/id'],
      cursor: '/created_at',
      order: 'oldest_first',
      list: '/bookings',
      with: { sort: 'asc', created_after: '{{ since }}' },
      tool: 'list_bookings',
    };

    expect(readTopicOf('booking.created', reordered)).toBe(readTopicOf('booking.created', listing));
  });

  it.each([
    ['another argument', 'booking.created', { ...listing, with: { created_after: '{{ since }}', sort: 'desc' } }],
    ['another tool', 'booking.created', { ...listing, tool: 'list_cancellations' }],
    ['another way to tell items apart', 'booking.created', { ...listing, id: ['/id', '/created_at'] }],
    ['another type', 'booking.made', listing],
  ])('is another for %s', (_case, type, read) => {
    expect(readTopicOf(type, read)).not.toBe(readTopicOf('booking.created', listing));
  });

  it('is a SHA-256 digest written in hex', () => {
    expect(readTopicOf('booking.created', listing)).toMatch(/^[0-9a-f]{64}$/u);
  });
});

const created: DeclaredRead = { connection: 'bookings', type: 'booking.created', read: listing };

const reorderedListing: TriggerRead = { ...listing, with: { sort: 'asc', created_after: '{{ since }}' } };

describe('the read a type names through one connection', () => {
  it.each([
    ['the same read, its keys in another order', { ...created, read: reorderedListing }, []],
    ['another read under another type', { ...created, type: 'booking.made', read: { ...listing, tool: 'list_x' } }, []],
    [
      'another read through another connection',
      { ...created, connection: 'rooms', read: { ...listing, tool: 'list_x' } },
      [],
    ],
    ['another read under the same type', { ...created, read: { ...listing, tool: 'list_x' } }, ['booking.created']],
    ['no read where the other names one', { connection: 'bookings', type: 'booking.created' }, ['booking.created']],
  ] as const satisfies readonly (readonly [string, DeclaredRead, readonly string[]])[])(
    'is held to the one already declared, for %s',
    (_case, asked, clashing) => {
      expect(readingAnotherUnderTheirType([asked], [created]).map(({ type }) => type)).toEqual(clashing);
    },
  );

  it('is held to the one an earlier trigger asked, and two triggers that name no read never clash', () => {
    const unread = { connection: 'tracker', type: 'item.added' };
    const other = { ...created, read: { ...listing, tool: 'list_x' } };

    expect(readingAnotherUnderTheirType([created, unread, other, unread], [])).toEqual([other]);
  });
});
