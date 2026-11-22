import { describe, expect, it } from 'vitest';

import { decodedEntry } from '../testing/entry-problems.ts';
import {
  aPost,
  mapping,
  ofTheApp,
  postTypes,
  reporting,
  roomType,
  trackerOverASocket,
  without,
} from '../testing/event-destinations.ts';
import { postTypeNamedBy, readingTheRoomsName } from '../testing/place-name-calls.ts';

const theName = '/events/types/0/subject/name';

const posted = [mapping(ofTheApp, aPost)];

function refusedWithItsName(name: unknown): readonly string[] {
  return reporting(posted, [postTypeNamedBy(name), roomType]).map(([path]) => path);
}

describe('the name of the place an event of a type happens in', () => {
  it.each([
    ['a tool, arguments that write the place and a pointer to the name', readingTheRoomsName, []],
    ['the same with no text before the name', without(readingTheRoomsName, 'prefix'), []],
    ['the place written inside a longer argument', { ...readingTheRoomsName, with: { q: 'id:{{ subject }}' } }, []],
    ['arguments that do not write the place', { ...readingTheRoomsName, with: { room: 'lobby' } }, [`${theName}/with`]],
    ['no arguments', without(readingTheRoomsName, 'with'), [`${theName}/with`]],
    ['a tool of the wrong shape', { ...readingTheRoomsName, tool: 'room info' }, [`${theName}/tool`]],
    ['a pointer that is no JSON Pointer', { ...readingTheRoomsName, named: 'room/title' }, [`${theName}/named`]],
    [
      'an argument that reads another name',
      { ...readingTheRoomsName, with: { room: '{{ subject }}', since: '{{ topic }}' } },
      [`${theName}/with/since`],
    ],
    [
      'a request in place of a tool',
      { ...readingTheRoomsName, method: 'GET', url: 'https://api.tracker.example.com/rooms' },
      [`${theName}/method`, `${theName}/url`],
    ],
    ['no tool', without(readingTheRoomsName, 'tool'), [`${theName}/tool`]],
  ] as const)('is declared by %s, or refused at its place', (_declared, name, refused) => {
    expect(refusedWithItsName(name)).toEqual(refused);
  });

  it('is kept as the entry declares it', () => {
    const types = [postTypeNamedBy(readingTheRoomsName), roomType];
    const entry = decodedEntry({ ...trackerOverASocket, events: { types, destinations: posted } });

    expect(entry.events?.types?.[0]?.subject?.name).toEqual(readingTheRoomsName);
  });

  it('is none where the type declares none, which reads as before', () => {
    const entry = decodedEntry({ ...trackerOverASocket, events: { types: postTypes, destinations: posted } });

    expect([reporting(posted), entry.events?.types?.[0]?.subject]).toEqual([[], { title: 'Room', required: false }]);
  });
});
