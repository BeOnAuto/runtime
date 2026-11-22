import { Schema } from 'effect';

import { PlaceNameSchema } from '../events/place-name-call.ts';
import { postType } from './event-destinations.ts';

export const readingTheRoomsName = {
  tool: 'room_info',
  with: { room: '{{ subject }}' },
  named: '/room/title',
  prefix: '#',
} as const;

export const theRoomsNameCall = Schema.decodeUnknownSync(PlaceNameSchema)(readingTheRoomsName);

export function postTypeNamedBy(name: unknown) {
  return { ...postType, subject: { ...postType.subject, name } };
}
